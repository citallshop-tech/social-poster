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
 * Postar en enskild produkt (bild + text + länk) till Facebook-sidan.
 * Kastar ett tydligt fel om något går fel - fångas upp och loggas separat
 * från Instagram-postningen av anroparen (lib/autoPost.ts), så att ett
 * fel på den ena plattformen aldrig stoppar den andra.
 */
export async function postProductToFacebook(
  product: ShopifyProduct
): Promise<{ postId: string }> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId) {
    throw new Error("FACEBOOK_PAGE_ID saknas i miljövariablerna.");
  }
  if (!pageAccessToken) {
    throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN saknas i miljövariablerna.");
  }
  if (!product.imageUrl) {
    throw new Error(`Produkten "${product.title}" saknar bild - kan inte postas.`);
  }

  const caption = buildCaption(product);

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: product.imageUrl,
      caption,
      access_token: pageAccessToken,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte publicera Facebook-inlägg: HTTP ${res.status} - ${bodyText.slice(0, 500)}`
    );
  }

  const data = (await res.json()) as { post_id?: string; id: string };
  return { postId: data.post_id ?? data.id };
}
