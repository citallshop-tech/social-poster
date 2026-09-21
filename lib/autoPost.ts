import { put, head } from "@vercel/blob";
import { getProductsFromCollection, type ShopifyProduct } from "./shopify";
import { postProductToInstagram } from "./instagram";
import { postProductToFacebook } from "./facebook";

// ============================================================================
// Väljer VILKEN produkt som ska postas idag, och håller reda på vilka som
// redan postats - byggd 2026-09-16.
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
// ============================================================================

const STATE_BLOB_PATH = "social-poster/posting-state.json";

type PostingState = {
  postedProductIds: string[];
  lastPostedAt: number | null;
};

async function readState(): Promise<PostingState> {
  try {
    const info = await head(STATE_BLOB_PATH);
    const res = await fetch(info.url, { cache: "no-store" });
    if (!res.ok) throw new Error("no state yet");
    return (await res.json()) as PostingState;
  } catch {
    return { postedProductIds: [], lastPostedAt: null };
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

/**
 * Postar dagens produkt till Instagram OCH Facebook. Kallas både av den
 * dagliga cron-rutten och av "Posta nästa produkt nu"-knappen (samma
 * logik, så de aldrig kan hamna i otakt med varandra).
 *
 * Instagram och Facebook postas oberoende av varandra - om den ena
 * plattformen misslyckas (t.ex. en utgången token) postas den andra ändå,
 * och felet syns bara i loggen/svaret för just den plattformen. Produkten
 * räknas som "postad" (och roterar vidare till nästa) så länge minst en
 * av de två lyckades - annars skulle en trasig plattform kunna låsa fast
 * hela rotationen på samma produkt varje dag.
 */
export async function postNextProduct(): Promise<
  | {
      posted: ShopifyProduct;
      instagram: PlatformResult;
      facebook: PlatformResult;
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

  const [instagramResult, facebookResult] = await Promise.all([
    postProductToInstagram(next)
      .then((r): PlatformResult => ({ ok: true, id: r.mediaId }))
      .catch((err): PlatformResult => ({ ok: false, error: String(err?.message ?? err) })),
    postProductToFacebook(next)
      .then((r): PlatformResult => ({ ok: true, id: r.postId }))
      .catch((err): PlatformResult => ({ ok: false, error: String(err?.message ?? err) })),
  ]);

  if (instagramResult.ok || facebookResult.ok) {
    state.postedProductIds.push(next.id);
    state.lastPostedAt = Date.now();
    await writeState(state);
  }

  return { posted: next, instagram: instagramResult, facebook: facebookResult };
}
