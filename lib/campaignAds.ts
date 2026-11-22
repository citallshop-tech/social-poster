import { put, head } from "@vercel/blob";
import { getActiveDiscountCampaigns, type ActiveCampaign } from "./discounts";
import { getProductsFromCollection, type ShopifyProduct } from "./shopify";
import {
  postImageToInstagram,
  postImageToInstagramStory,
  postImagesToInstagramCarousel,
} from "./instagram";
import { postImageToFacebook, postImageToFacebookStory, postImagesToFacebook } from "./facebook";

// ============================================================================
// Periodiska "kampanj-annons"-inlägg - byggt 2026-11-22 på Christoffers
// uttryckliga begäran: "Periodiska 'annons'-inlägg under kampanjerna som
// var tredje dag under annons perioden." Separat från den vanliga
// produktrotationen (lib/autoPost.ts, postNextProduct) - postar en EXTRA
// bild/text som pekar på en aktiv rabattkampanj (titel + procent + kod +
// sista dag), inte en vanlig produkt.
//
// "Var tredje dag" räknas från kampanjens EGEN startsAt (dag 0, 3, 6, 9…
// sedan starten, i hela UTC-dygn) - inte från när cronen råkar köras.
// Postas EN gång per sådan "annonsdag" per kampanj, oavsett hur många
// gånger cronen körs samma dag - spåras i Vercel Blob (samma mönster som
// lib/autoPost.ts posting-state.json), nyckel = kampanjens Shopify-id.
//
// Bild: det finns ingen egen annons-grafik för kampanjer, så vi
// återanvänder bilden från en produkt som redan är i den vanliga
// postningsrotationen (AUTO_POST_COLLECTIONS) - en riktig produktbild
// ser bättre ut i flödet än en tom/generisk ruta. Dela gärna in en egen
// kampanjgrafik senare om Christoffer vill ha det snyggare.
// ============================================================================

const STATE_BLOB_PATH = "social-poster/campaign-ad-state.json";
const AD_INTERVAL_DAYS = 3;

type CampaignAdState = Record<string, { lastAdPostedDate: string }>; // nyckel = kampanjens id

async function readState(): Promise<CampaignAdState> {
  try {
    const info = await head(STATE_BLOB_PATH);
    const res = await fetch(info.url, { cache: "no-store" });
    if (!res.ok) throw new Error("no state yet");
    return (await res.json()) as CampaignAdState;
  } catch {
    return {};
  }
}

async function writeState(state: CampaignAdState): Promise<void> {
  await put(STATE_BLOB_PATH, JSON.stringify(state), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

function todayDateString(): string {
  // UTC-datum, "YYYY-MM-DD" - konsekvent oavsett vilken tid på dygnet cronen körs.
  return new Date().toISOString().slice(0, 10);
}

function isAdDay(campaign: ActiveCampaign): boolean {
  const startMs = new Date(campaign.startsAt).getTime();
  const nowMs = Date.now();
  const daysSinceStart = Math.floor((nowMs - startMs) / (24 * 60 * 60 * 1000));
  return daysSinceStart >= 0 && daysSinceStart % AD_INTERVAL_DAYS === 0;
}

function buildAdCaption(campaign: ActiveCampaign): string {
  const pct = campaign.percentage !== null ? `${campaign.percentage}% rabatt` : "Rabatt";
  const codeLine = campaign.code ? `Kod: ${campaign.code}` : "";
  const endLine = campaign.endsAt
    ? `Gäller t.o.m. ${new Date(campaign.endsAt).toLocaleDateString("sv-SE")}.`
    : "";
  return [
    `🎉 ${campaign.title}`,
    "",
    [pct, codeLine].filter(Boolean).join(" — "),
    endLine,
    "",
    "👉 Länk i bio för att handla",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

async function pickAdImage(): Promise<ShopifyProduct | null> {
  const collectionsRaw = process.env.AUTO_POST_COLLECTIONS;
  if (!collectionsRaw) return null;
  const handles = collectionsRaw
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  for (const handle of handles) {
    const products = await getProductsFromCollection(handle);
    const withImage = products.find((p) => p.imageUrl);
    if (withImage) return withImage;
  }
  return null;
}

type PlatformResult = { ok: true; id: string } | { ok: false; error: string };

async function toResult(
  promise: Promise<{ mediaId: string } | { postId: string }>
): Promise<PlatformResult> {
  try {
    const r = await promise;
    const id = "mediaId" in r ? r.mediaId : r.postId;
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

export type CampaignAdResult = {
  campaign: ActiveCampaign;
  instagram: PlatformResult;
  instagramStory: PlatformResult;
  facebook: PlatformResult;
  facebookStory: PlatformResult;
};

/**
 * Kollar alla aktiva rabattkampanjer och postar ett annonsinlägg (fyra
 * kanaler, samma mönster som postNextProduct i lib/autoPost.ts) för
 * VARJE kampanj som har en "annonsdag" idag och inte redan fått sin
 * annons postad idag. Returnerar en lista - en post per kampanj som
 * postades (tom lista om ingen kampanj hade en annonsdag idag, eller
 * ingen kampanj är aktiv alls).
 *
 * options.force: hoppar över "var tredje dag"-spärren (men INTE
 * "redan postad idag"-spärren) - används av det manuella testknapp-
 * flödet (app/api/admin/post-campaign-ad-now/route.ts) så Christoffer
 * kan testa direkt utan att vänta på en riktig annonsdag.
 */
export async function postCampaignAdsIfDue(options?: {
  force?: boolean;
}): Promise<CampaignAdResult[]> {
  const campaigns = await getActiveDiscountCampaigns();
  if (campaigns.length === 0) return [];

  const state = await readState();
  const today = todayDateString();
  const due = campaigns.filter((c) => {
    if (state[c.id]?.lastAdPostedDate === today) return false;
    return options?.force ? true : isAdDay(c);
  });
  if (due.length === 0) return [];

  const adImage = await pickAdImage();
  if (!adImage || !adImage.imageUrl) {
    console.warn(
      "[Social poster] Kampanj-annons: hittade ingen produktbild att använda, hoppar över."
    );
    return [];
  }

  // Om annonsbildens produkt har flera bilder, postas en karusell/
  // flerbildsinlägg till flödena (samma "bildserie"-mönster som de
  // vanliga produktposterna, se lib/instagram.ts/lib/facebook.ts) -
  // Storyn är alltid EN bild (plattformarna stödjer inte karusell-storys
  // via det här API:et).
  const hasMultipleImages = adImage.imageUrls.length >= 2;

  const results: CampaignAdResult[] = [];
  for (const campaign of due) {
    const caption = buildAdCaption(campaign);
    const [instagramResult, instagramStoryResult, facebookResult, facebookStoryResult] =
      await Promise.all([
        toResult(
          hasMultipleImages
            ? postImagesToInstagramCarousel(adImage.imageUrls, caption)
            : postImageToInstagram(adImage.imageUrl, caption)
        ),
        toResult(postImageToInstagramStory(adImage.imageUrl)),
        toResult(
          hasMultipleImages
            ? postImagesToFacebook(adImage.imageUrls, caption)
            : postImageToFacebook(adImage.imageUrl, caption)
        ),
        toResult(postImageToFacebookStory(adImage.imageUrl)),
      ]);

    const anyOk =
      instagramResult.ok || instagramStoryResult.ok || facebookResult.ok || facebookStoryResult.ok;
    if (anyOk) {
      state[campaign.id] = { lastAdPostedDate: today };
    }

    results.push({
      campaign,
      instagram: instagramResult,
      instagramStory: instagramStoryResult,
      facebook: facebookResult,
      facebookStory: facebookStoryResult,
    });
  }

  await writeState(state);
  return results;
}
