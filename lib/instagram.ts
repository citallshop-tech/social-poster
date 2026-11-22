import type { ShopifyProduct } from "./shopify";
import { getValidInstagramAccessToken } from "./instagramToken";

// ============================================================================
// Instagram-publicering — byggd 2026-09-16, via "Instagram API with
// Instagram Login" (graph.instagram.com), samma flöde som redan användes
// för att koppla in kontot (se README, Steg 2). Källa: Metas officiella
// dokumentation för "Publish Content using the Instagram Platform"
// (developers.facebook.com/docs/instagram-platform/content-publishing/).
//
// Två-stegsprocess för en bild:
//   1. POST .../media  → skapar en "container" (image_url + caption),
//      returnerar ett creation_id.
//   2. POST .../media_publish → publicerar containern med det id:t.
// För en enskild bild (inte video/karusell) blir containern klar direkt i
// praktiken, men vi pollar ändå kort på status_code som extra säkerhet
// innan publicering (se väntUntilContainerReady nedan).
//
// Hämtar ALLTID token via getValidInstagramAccessToken() (lib/
// instagramToken.ts) - ALDRIG process.env.INSTAGRAM_ACCESS_TOKEN direkt -
// så den automatiska token-förnyelsen alltid används.
//
// VIKTIGT, bekräftat 2026-11-22 (Christoffer hade rätt, inte gissat - se
// Metas egen referens för POST /{ig-user-id}/media, sektionen "Story
// Limitations": "Publishing stickers (i.e., link, poll, location) is not
// supported"): en länk i bildtexten på ett vanligt Instagram-inlägg går
// INTE att klicka på - det är en plattformsbegränsning, inte en bugg i den
// här koden. Samma gäller Stories som postas via API:et - det går inte att
// bifoga en klickbar länk-sticker den vägen heller, bara manuellt i appen.
// Lösningen här: bildtexten ber om "länk i bio" istället för att visa en
// död URL, och Instagram-profilens bio-länk pekas (en gång, manuellt) mot
// /out-routen i den här appen (app/out/route.ts) - den sidan skickar
// automatiskt vidare till VAD SOM HELST som postades senast, så bio-länken
// aldrig behöver uppdateras för hand igen.
// ============================================================================

const GRAPH_VERSION = "v21.0";

function buildCaption(product: ShopifyProduct): string {
  const priceLine = `${product.priceSek} kr`;
  const shortDescription = product.description.slice(0, 300);
  return [
    product.title,
    "",
    shortDescription,
    "",
    priceLine,
    "👉 Länk i bio för att handla",
  ]
    .join("\n")
    .trim();
}

async function waitUntilContainerReady(containerId: string, accessToken: string): Promise<void> {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(
      `https://graph.instagram.com/${GRAPH_VERSION}/${containerId}?fields=status_code&access_token=${encodeURIComponent(
        accessToken
      )}`
    );
    if (res.ok) {
      const data = (await res.json()) as { status_code?: string };
      if (data.status_code === "FINISHED") return;
      if (data.status_code === "ERROR") {
        throw new Error("Instagram kunde inte förbereda bilden (status_code ERROR).");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  // Efter max antal försök fortsätter vi ändå - enstaka bilder är i
  // praktiken nästan alltid klara direkt, det här är bara ett extra
  // säkerhetsnät, inte ett hårt krav enligt Metas egen dokumentation.
}

/**
 * Postar en enskild produkt (bild + text + länk) till Instagram-kontot.
 * Kastar ett tydligt fel om något går fel - fångas upp och loggas av
 * anroparen (lib/autoPost.ts), precis som PostNord-mönstret i Farvyo
 * (logga tydligt, men krascha aldrig hela flödet i onödan).
 */
export async function postProductToInstagram(
  product: ShopifyProduct
): Promise<{ mediaId: string }> {
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_BUSINESS_ACCOUNT_ID saknas i miljövariablerna.");
  }
  if (!product.imageUrl) {
    throw new Error(`Produkten "${product.title}" saknar bild - kan inte postas.`);
  }

  const accessToken = await getValidInstagramAccessToken();
  const caption = buildCaption(product);

  const createRes = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${accountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: product.imageUrl,
      caption,
      access_token: accessToken,
    }),
  });

  if (!createRes.ok) {
    const bodyText = await createRes.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte skapa Instagram-inlägg (media): HTTP ${createRes.status} - ${bodyText.slice(0, 500)}`
    );
  }

  const createData = (await createRes.json()) as { id: string };
  await waitUntilContainerReady(createData.id, accessToken);

  const publishRes = await fetch(
    `https://graph.instagram.com/${GRAPH_VERSION}/${accountId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: accessToken,
      }),
    }
  );

  if (!publishRes.ok) {
    const bodyText = await publishRes.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte publicera Instagram-inlägg: HTTP ${publishRes.status} - ${bodyText.slice(0, 500)}`
    );
  }

  const publishData = (await publishRes.json()) as { id: string };
  return { mediaId: publishData.id };
}

/**
 * Postar produktbilden som en Instagram STORY (byggd 2026-11-22) - samma
 * tvåstegsflöde som ett vanligt inlägg (media → media_publish), bara med
 * media_type=STORIES tillagt. Extra räckvidd/visningar utöver flödesinlägget,
 * men OBS: Meta tillåter INTE en klickbar länk-sticker via det här API:et
 * (bekräftat ovan) - stories postade här har ingen klickbar länk alls, bara
 * bilden. Bildtexten/texten på själva bilden bör därför redan säga "länk i
 * bio" om den ska driva trafik. Anropas separat, inte automatiskt från
 * postNextProduct() än - lägg till ett anrop där om Christoffer vill att
 * den dagliga cronen postar en story varje dag också.
 */
export async function postProductToInstagramStory(
  product: ShopifyProduct
): Promise<{ mediaId: string }> {
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_BUSINESS_ACCOUNT_ID saknas i miljövariablerna.");
  }
  if (!product.imageUrl) {
    throw new Error(`Produkten "${product.title}" saknar bild - kan inte postas som story.`);
  }

  const accessToken = await getValidInstagramAccessToken();

  const createRes = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${accountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: product.imageUrl,
      media_type: "STORIES",
      access_token: accessToken,
    }),
  });

  if (!createRes.ok) {
    const bodyText = await createRes.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte skapa Instagram-story (media): HTTP ${createRes.status} - ${bodyText.slice(0, 500)}`
    );
  }

  const createData = (await createRes.json()) as { id: string };
  await waitUntilContainerReady(createData.id, accessToken);

  const publishRes = await fetch(
    `https://graph.instagram.com/${GRAPH_VERSION}/${accountId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: accessToken,
      }),
    }
  );

  if (!publishRes.ok) {
    const bodyText = await publishRes.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte publicera Instagram-story: HTTP ${publishRes.status} - ${bodyText.slice(0, 500)}`
    );
  }

  const publishData = (await publishRes.json()) as { id: string };
  return { mediaId: publishData.id };
}
