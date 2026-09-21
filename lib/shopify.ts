export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  priceSek: string;
  imageUrl: string | null;
  productUrl: string;
}

// ============================================================================
// Uppdaterat 2026-09-16: Shopify tog bort det gamla "Develop apps"-flödet
// (det som gav en permanent SHOPIFY_ADMIN_API_TOKEN) den 1 januari 2026.
// Appar skapade i Dev Dashboard får istället ett Client ID + Client secret,
// och hämtar själva en tillfällig token (giltig i 24 timmar, 86399 sekunder
// enligt Shopifys svar) via "client credentials grant". Se
// https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens.
// Token cachas i minnet nedan så vi inte hämtar en ny för varje enskilt
// API-anrop - men cachen lever bara så länge samma serverless-instans är
// varm (helt ofarligt här, appen kör bara en gång/dag + enstaka
// "Posta nästa produkt nu"-klick, inte högfrekvent).
// ============================================================================
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAdminApiToken(domain: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SHOPIFY_CLIENT_ID eller SHOPIFY_CLIENT_SECRET saknas.");
  }

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`Kunde inte hämta Shopify-token: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };

  // 60 sekunders marginal så vi aldrig råkar använda en token som hinner
  // löpa ut mitt under ett pågående anrop.
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

/**
 * Fetches products from a Shopify collection by its handle (the part of
 * the URL after /collections/, e.g. "hemma" for citall.store/collections/hemma).
 * Uses the Admin API - requires SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID och
 * SHOPIFY_CLIENT_SECRET att vara satta (se getAdminApiToken ovan).
 */
export async function getProductsFromCollection(
  collectionHandle: string
): Promise<ShopifyProduct[]> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN; // e.g. your-store.myshopify.com
  const publicDomain = process.env.SHOPIFY_PUBLIC_DOMAIN; // e.g. citall.store

  if (!domain || !publicDomain) {
    throw new Error("SHOPIFY_STORE_DOMAIN eller SHOPIFY_PUBLIC_DOMAIN saknas.");
  }

  const token = await getAdminApiToken(domain);

  // Admin API doesn't fetch "by collection handle" directly - first
  // resolve the handle to a collection ID via the storefront-style
  // custom_collections/smart_collections lookup, then list products in it.
  const collectionRes = await fetch(
    `https://${domain}/admin/api/2025-01/custom_collections.json?handle=${encodeURIComponent(collectionHandle)}`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  let collectionId: string | null = null;

  if (collectionRes.ok) {
    const data = await collectionRes.json();
    collectionId = data.custom_collections?.[0]?.id ?? null;
  }

  if (!collectionId) {
    // Not a manual (custom) collection - try smart collections too.
    const smartRes = await fetch(
      `https://${domain}/admin/api/2025-01/smart_collections.json?handle=${encodeURIComponent(collectionHandle)}`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (smartRes.ok) {
      const data = await smartRes.json();
      collectionId = data.smart_collections?.[0]?.id ?? null;
    }
  }

  if (!collectionId) {
    throw new Error(`Hittade ingen kollektion med handle "${collectionHandle}".`);
  }

  const productsRes = await fetch(
    `https://${domain}/admin/api/2025-01/collections/${collectionId}/products.json?limit=50`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (!productsRes.ok) {
    throw new Error(`Kunde inte hämta produkter: ${productsRes.status}`);
  }
  const data = await productsRes.json();

  return (data.products ?? []).map(
    (p: {
      id: number;
      title: string;
      handle: string;
      body_html?: string;
      variants?: { price?: string }[];
      images?: { src: string }[];
    }) => ({
      id: String(p.id),
      title: p.title,
      handle: p.handle,
      description: (p.body_html ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 300),
      priceSek: p.variants?.[0]?.price ?? "0",
      imageUrl: p.images?.[0]?.src ?? null,
      productUrl: `https://${publicDomain}/products/${p.handle}`,
    })
  );
}
