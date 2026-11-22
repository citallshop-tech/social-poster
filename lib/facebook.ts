import type { ShopifyProduct } from "./shopify";

// ============================================================================
// Facebook-publicering — byggd 2026-09-17, via en Sidåtkomsttoken (Page
// Access Token) för sidan "C it all store", hämtad manuellt av Christoffer
// via Graph API Explorer (Meta-appen "citall-poster"):
//   1. Genererade en User Access Token med rättigheterna pages_show_list,
//      business_management, pages_read_engagement, pages_manage_metadata,
//      pages_manage_posts (valde bara sidan "C it all store", inte alla
//      nuvarande/framtida sidor).
//   2. Förlängde den till en långlivad User Access Token via Access Token
//      Debugger ("Extend Access Token Expiration") - varar ~60 dagar.
//   3. Hämtade sidans EGNA token via GET /me/accounts med den långlivade
//      User Access Token:en - det är DEN token som sparas i
//      FACEBOOK_PAGE_ACCESS_TOKEN.
//
// Till skillnad från Instagram (lib/instagramToken.ts) behöver en
// sid-token som härstammar från en långlivad User Access Token INTE
// förnyas automatiskt - Metas dokumentation beskriver den som praktiskt
// taget icke-utgående så länge Christoffer inte byter lösenord, tar bort
// appens åtkomst, eller appen/sidan tappar sin koppling. Ingen
// tokenFörnyelse-modul behövs alltså här, bara statisk lagring i
// miljövariabler (FACEBOOK_PAGE_ACCESS_TOKEN + FACEBOOK_PAGE_ID).
//
// Postar via /{page-id}/photos - ett enda anrop (bild + text i samma
// steg), till skillnad från Instagrams tvåstegsprocess (container ->
// publish) som krävs där.
// ============================================================================

const GRAPH_VERSION = "v21.0";

function buildCaption(product: ShopifyProduct): string {
  const priceLine = `${product.priceSek} kr`;
  const shortDescription = product.description.slice(0, 300);
  return [product.title, "", shortDescription, "", priceLine, product.productUrl]
    .join("\n")
    .trim();
}

/**
 * Lågnivå-primitiv (utbruten 2026-11-22 från den ursprungliga
 * postProductToFacebook, så kampanj-annonsfunktionen i
 * lib/campaignAds.ts kan återanvända samma uppladdning utan en
 * ShopifyProduct). Laddar upp en bild till sidan - extraFields styr om
 * den publiceras direkt (vanligt inlägg) eller inte (story, steg 1).
 */
async function uploadPhoto(
  pageId: string,
  pageAccessToken: string,
  imageUrl: string,
  extraFields: Record<string, string | boolean>
): Promise<{ id: string; post_id?: string }> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: imageUrl,
      access_token: pageAccessToken,
      ...extraFields,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte publicera Facebook-bild: HTTP ${res.status} - ${bodyText.slice(0, 500)}`
    );
  }

  return (await res.json()) as { id: string; post_id?: string };
}

/**
 * Postar en valfri bild + bildtext till Facebook-sidans FLÖDE. Används
 * av både postProductToFacebook (nedan) och kampanj-annonserna
 * (lib/campaignAds.ts).
 */
export async function postImageToFacebook(
  imageUrl: string,
  caption: string
): Promise<{ postId: string }> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId) {
    throw new Error("FACEBOOK_PAGE_ID saknas i miljövariablerna.");
  }
  if (!pageAccessToken) {
    throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN saknas i miljövariablerna.");
  }
  const data = await uploadPhoto(pageId, pageAccessToken, imageUrl, { caption });
  return { postId: data.post_id ?? data.id };
}

/**
 * Postar en enskild produkt (bild + text + länk) till Facebook-sidan.
 * Kastar ett tydligt fel om något går fel - fångas upp och loggas separat
 * från Instagram-postningen av anroparen (lib/autoPost.ts), så att ett
 * fel på den ena plattformen aldrig stoppar den andra.
 */
/**
 * Postar FLERA bilder som ETT flerbildsinlägg (bildserie) till
 * Facebook-sidans flöde - byggd 2026-11-22 på Christoffers begäran.
 * Facebooks mönster för det här (dokumenterat av Meta): ladda upp varje
 * bild OSPUBLICERAD via /{page-id}/photos (published:false, samma
 * uploadPhoto-hjälpare som redan används för stories) - det ger ett
 * photo_id per bild utan att skapa separata inlägg - och skapa sen ETT
 * /{page-id}/feed-inlägg med alla photo_id:n i attached_media. Max 10
 * bilder (samma gräns som Instagrams karusell, för konsekvens).
 */
export async function postImagesToFacebook(
  imageUrls: string[],
  caption: string
): Promise<{ postId: string }> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId) {
    throw new Error("FACEBOOK_PAGE_ID saknas i miljövariablerna.");
  }
  if (!pageAccessToken) {
    throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN saknas i miljövariablerna.");
  }
  const urls = imageUrls.slice(0, 10);
  if (urls.length < 2) {
    throw new Error("Ett flerbildsinlägg kräver minst 2 bilder.");
  }

  const photoIds: string[] = [];
  for (const url of urls) {
    const uploaded = await uploadPhoto(pageId, pageAccessToken, url, { published: false });
    photoIds.push(uploaded.id);
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: caption,
      attached_media: photoIds.map((id) => ({ media_fbid: id })),
      access_token: pageAccessToken,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte publicera Facebook-flerbildsinlägg: HTTP ${res.status} - ${bodyText.slice(0, 500)}`
    );
  }

  const data = (await res.json()) as { id: string };
  return { postId: data.id };
}

/**
 * Postar en enskild produkt till Facebook-sidan - som flerbildsinlägg
 * (bildserie) om produkten har 2 eller fler bilder i Shopify (upp till
 * 10), annars som ett vanligt enbildsinlägg.
 */
export async function postProductToFacebook(
  product: ShopifyProduct
): Promise<{ postId: string }> {
  if (!product.imageUrl) {
    throw new Error(`Produkten "${product.title}" saknar bild - kan inte postas.`);
  }
  const caption = buildCaption(product);
  if (product.imageUrls.length >= 2) {
    return postImagesToFacebook(product.imageUrls, caption);
  }
  return postImageToFacebook(product.imageUrl, caption);
}

/**
 * Postar produktbilden som en Facebook-sida-STORY (byggd 2026-11-22),
 * via Metas dokumenterade "Page Stories API"
 * (developers.facebook.com/docs/page-stories-api). Kräver samma
 * pages_manage_posts-rättighet som redan finns på FACEBOOK_PAGE_ACCESS_TOKEN
 * sen tidigare - inget nytt godkännande behövs.
 *
 * Tvåstegsflöde, enligt Metas egen dokumentation:
 *   1. Ladda upp bilden OPUBLICERAD via /{page-id}/photos (published=false)
 *      - returnerar ett photo_id. Metas regler kräver att bilden INTE redan
 *      använts i ett publicerat inlägg, så den här uppladdningen måste vara
 *      separat från postProductToFacebook() ovan, aldrig samma anrop/id.
 *   2. POST /{page-id}/photo_stories med det photo_id:t - publicerar storyn.
 *
 * Till skillnad från Instagram-storyn (lib/instagram.ts) stöder Facebooks
 * Page Stories-API faktiskt ingen klickbar länk-sticker heller via det här
 * flödet - samma plattformsbegränsning, ingen länk i storyn.
 */
export async function postProductToFacebookStory(
  product: ShopifyProduct
): Promise<{ postId: string }> {
  if (!product.imageUrl) {
    throw new Error(`Produkten "${product.title}" saknar bild - kan inte postas som story.`);
  }
  return postImageToFacebookStory(product.imageUrl);
}

/**
 * Postar en valfri bild som Facebook-sida-STORY (samma Page Stories
 * API-flöde som ovan, utan ShopifyProduct). Används av både
 * postProductToFacebookStory (ovan) och kampanj-annonserna
 * (lib/campaignAds.ts).
 */
export async function postImageToFacebookStory(imageUrl: string): Promise<{ postId: string }> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId) {
    throw new Error("FACEBOOK_PAGE_ID saknas i miljövariablerna.");
  }
  if (!pageAccessToken) {
    throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN saknas i miljövariablerna.");
  }

  const uploadData = await uploadPhoto(pageId, pageAccessToken, imageUrl, { published: false });

  const storyRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photo_stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      photo_id: uploadData.id,
      access_token: pageAccessToken,
    }),
  });

  if (!storyRes.ok) {
    const bodyText = await storyRes.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte publicera Facebook-story: HTTP ${storyRes.status} - ${bodyText.slice(0, 500)}`
    );
  }

  const storyData = (await storyRes.json()) as { post_id?: string; id?: string };
  return { postId: storyData.post_id ?? storyData.id ?? uploadData.id };
}
