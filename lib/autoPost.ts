import { put, head } from "@vercel/blob";
import { getProductsFromCollection, type ShopifyProduct } from "./shopify";
import { postProductToInstagram, postProductToInstagramStory } from "./instagram";
import { postProductToFacebook, postProductToFacebookStory } from "./facebook";

// ============================================================================
// Väljer VILKEN produkt som ska postas, och håller reda på vilka som redan
// postats - byggd 2026-09-16.
//
// Ingen databas i det här projektet, så "vilka har postats" sparas i
// Vercel Blob (samma lagring som instagramToken.ts använder för tokenen).
// Roterar genom ALLA produkter i AUTO_POST_COLLECTIONS (kommaseparerade
// kollektions-handles) utan att upprepa någon förrän alla andra hunnit
// postas en gång - när ett helt varv är klart börjar det om från början.
//
// Produktlistan hämtas fräsch från Shopify varje gång (inte cachad i
// state) så pris/bild/lagerstatus alltid är aktuellt när något postas -
// bara VILKA id:n som redan postats sparas mellan körningar.
//
// Uppdaterad 2026-11-22 (två saker):
// 1. lagrar nu också lastPostedProductUrl - den senast postade produktens
//    riktiga länk. Länkar i Instagram-bildtexter går inte att klicka på
//    (bekräftad plattformsbegränsning, se lib/instagram.ts), så
//    Instagram-bildtexten pekar numera bara på "länk i bio" istället för
//    en död URL. getLastPostedProductUrl() nedan läses av /out-routen
//    (app/out/route.ts), som Instagram-bio-länken ska pekas mot EN gång
//    (manuellt, i appen) - den sidan skickar sedan automatiskt vidare till
//    vad som faktiskt postades senast.
// 2. postar nu BÅDE ett vanligt flödesinlägg OCH en Story, på BÅDA
//    plattformarna, varje gång den körs (fyra postningar per körning:
//    Instagram-flöde, Instagram-story, Facebook-flöde, Facebook-story) -
//    Christoffer ville inte ha story ENSAMT istället för flödet (en story
//    försvinner efter 24 timmar, flödet ligger kvar), utan båda. Cronen
//    kör nu 3 ggr/dag istället för 1 (se vercel.json) för högre frekvens.
//    Alla fyra postningar är oberoende av varandra (var sin try/catch) -
//    ett fel på en kanal stoppar aldrig de andra tre.
// ============================================================================

const STATE_BLOB_PATH = "social-poster/posting-state.json";

type PostingState = {
  postedProductIds: string[];
  lastPostedAt: number | null;
  lastPostedProductUrl: string | null;
};

async function readState(): Promise<PostingState> {
  try {
    const info = await head(STATE_BLOB_PATH);
    const res = await fetch(info.url, { cache: "no-store" });
    if (!res.ok) throw new Error("no state yet");
    const data = (await res.json()) as Partial<PostingState>;
    // Bakåtkompatibelt: äldre state-filer saknar lastPostedProductUrl.
    return {
      postedProductIds: data.postedProductIds ?? [],
      lastPostedAt: data.lastPostedAt ?? null,
      lastPostedProductUrl: data.lastPostedProductUrl ?? null,
    };
  } catch {
    return { postedProductIds: [], lastPostedAt: null, lastPostedProductUrl: null };
  }
}

async function writeState(state: PostingState): Promise<void> {
  await put(STATE_BLOB_PATH, JSON.stringify(state), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

/**
 * Läser av vilken produktlänk Instagram-profilens bio-länk ska skicka
 * vidare till just nu - den senast postade produkten. Används av
 * app/out/route.ts. Om inget någonsin postats än (första körningen, eller
 * blob-lagringen är tom) skickas besökaren till butikens startsida istället
 * för att krascha eller visa en tom sida.
 */
export async function getLastPostedProductUrl(): Promise<string> {
  const state = await readState();
  if (state.lastPostedProductUrl) return state.lastPostedProductUrl;
  const publicDomain = process.env.SHOPIFY_PUBLIC_DOMAIN ?? "citall.store";
  return `https://${publicDomain}`;
}

async function getAllEligibleProducts(): Promise<ShopifyProduct[]> {
  const collectionsRaw = process.env.AUTO_POST_COLLECTIONS;
  if (!collectionsRaw) {
    throw new Error("AUTO_POST_COLLECTIONS saknas i miljövariablerna.");
  }
  const handles = collectionsRaw
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const all: ShopifyProduct[] = [];
  const seenIds = new Set<string>();
  for (const handle of handles) {
    const products = await getProductsFromCollection(handle);
    for (const product of products) {
      // Produkter utan bild kan inte postas till Instagram alls - hoppa
      // över dem tyst istället för att fastna på dem varje dag.
      if (!seenIds.has(product.id) && product.imageUrl) {
        seenIds.add(product.id);
        all.push(product);
      }
    }
  }
  return all;
}

type PlatformResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

async function toResult(promise: Promise<{ mediaId: string } | { postId: string }>): Promise<PlatformResult> {
  try {
    const r = await promise;
    const id = "mediaId" in r ? r.mediaId : r.postId;
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/**
 * Postar dagens produkt till Instagram-flödet, Instagram-story,
 * Facebook-flödet OCH Facebook-story - fyra oberoende postningar för
 * samma produkt. Kallas både av den schemalagda cron-rutten (3 ggr/dag,
 * se vercel.json) och av "Posta nästa produkt nu"-knappen (samma logik,
 * så de aldrig kan hamna i otakt med varandra).
 *
 * Alla fyra postas oberoende av varandra - om en kanal misslyckas (t.ex.
 * en utgången token) postas de andra tre ändå, och felet syns bara i
 * loggen/svaret för just den kanalen. Produkten räknas som "postad" (och
 * roterar vidare till nästa) så länge MINST EN av de fyra lyckades -
 * annars skulle en trasig kanal kunna låsa fast hela rotationen på samma
 * produkt.
 */
export async function postNextProduct(): Promise<
  | {
      posted: ShopifyProduct;
      instagram: PlatformResult;
      instagramStory: PlatformResult;
      facebook: PlatformResult;
      facebookStory: PlatformResult;
    }
  | { skipped: string }
> {
  const allProducts = await getAllEligibleProducts();
  if (allProducts.length === 0) {
    return { skipped: "Inga produkter med bild hittades i AUTO_POST_COLLECTIONS." };
  }

  const state = await readState();
  let remaining = allProducts.filter((p) => !state.postedProductIds.includes(p.id));

  if (remaining.length === 0) {
    // Ett helt varv genom alla produkter är klart - börja om.
    remaining = allProducts;
    state.postedProductIds = [];
  }

  const next = remaining[0];

  const [instagramResult, instagramStoryResult, facebookResult, facebookStoryResult] = await Promise.all([
    toResult(postProductToInstagram(next)),
    toResult(postProductToInstagramStory(next)),
    toResult(postProductToFacebook(next)),
    toResult(postProductToFacebookStory(next)),
  ]);

  const anyOk =
    instagramResult.ok || instagramStoryResult.ok || facebookResult.ok || facebookStoryResult.ok;

  if (anyOk) {
    state.postedProductIds.push(next.id);
    state.lastPostedAt = Date.now();
    state.lastPostedProductUrl = next.productUrl;
    await writeState(state);
  }

  return {
    posted: next,
    instagram: instagramResult,
    instagramStory: instagramStoryResult,
    facebook: facebookResult,
    facebookStory: facebookStoryResult,
  };
}
