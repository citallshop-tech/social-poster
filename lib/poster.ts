import { getProductsFromCollection } from "./shopify";
import { postToInstagram } from "./instagram";
import { loadState, markPosted } from "./state";

function buildCaption(product: { title: string; description: string; priceSek: string; productUrl: string }): string {
  const shortDescription = product.description.split(".")[0]?.trim();
  return [
    product.title,
    shortDescription ? `${shortDescription}.` : null,
    `${Number(product.priceSek).toFixed(0)} kr.`,
    `Handgjord i Sverige. Länk i bio, eller: ${product.productUrl}`,
    "",
    "#madeinSweden #handgjort #hantverk #svensktdesign",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface PostResult {
  posted: boolean;
  productTitle?: string;
  instagramPostId?: string;
  reason?: string;
}

/**
 * Reads the configured collection handles from
 * AUTO_POST_COLLECTIONS (comma-separated, e.g. "hemma,kontor"),
 * finds the first product across them that hasn't been posted yet,
 * and posts it. Returns what happened so the caller (cron route or
 * manual trigger) can report it back.
 */
export async function postNextProduct(): Promise<PostResult> {
  const collectionsEnv = process.env.AUTO_POST_COLLECTIONS;
  if (!collectionsEnv) {
    return { posted: false, reason: "AUTO_POST_COLLECTIONS är inte satt." };
  }
  const collectionHandles = collectionsEnv.split(",").map((c) => c.trim()).filter(Boolean);

  const state = await loadState();
  const postedIds = new Set(state.postedProductIds);

  for (const handle of collectionHandles) {
    const products = await getProductsFromCollection(handle);
    const next = products.find((p) => !postedIds.has(p.id) && p.imageUrl);

    if (next && next.imageUrl) {
      const caption = buildCaption(next);
      const instagramPostId = await postToInstagram(next.imageUrl, caption);
      await markPosted(next.id);
      return { posted: true, productTitle: next.title, instagramPostId };
    }
  }

  return { posted: false, reason: "Inga fler oposta produkter i de valda kollektionerna." };
}
