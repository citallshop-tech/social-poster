import { adminGraphQL } from "./shopify";
import { SEASONS, currentOrNextWindow, type SeasonConfig } from "./seasons";

// ============================================================================
// Säsongsrabatter — säkerställer att varje säsong/högtid som ska ha en
// rabattkod (se lib/seasons.ts) har en skapad och schemalagd kod för sin
// NÄSTA (eller pågående) period, tajmad exakt mot samma datum som
// meny-synken (lib/menuSync.ts) visar/döljer kollektionen.
//
// Körs dagligen (samma cron som menyn) - men eftersom koden bara skapas EN
// gång per period (kollar om koden redan finns innan den försöker skapa en
// ny) spelar det ingen roll hur ofta den körs eller hur långt i förväg
// perioden ligger. Shopify sköter sen SJÄLV när koden faktiskt aktiveras/
// avaktiveras (startsAt/endsAt) - helt utan att vår kod behöver göra något
// mer den dagen.
// ============================================================================

const CODE_LOOKUP_QUERY = `
  query CodeExists($code: String!) {
    codeDiscountNodeByCode(code: $code) { id }
  }
`;

const HAS_PRODUCT_QUERY = `
  query HasProduct($id: ID!) {
    node(id: $id) {
      ... on Collection { hasProduct }
    }
  }
`;

/**
 * En rabatt som bara gäller EN specifik kollektion ("scope: collection") är
 * meningslös att skapa innan kollektionen har någon produkt att ge rabatt på
 * - skapas i stället så fort den får sin första produkt (kollas varje dag,
 * se claude/citall-store-kollektioner-taggar.md för pågående taggningsarbete).
 * En rabatt för hela butiken ("scope: storewide") berörs inte av detta.
 */
async function collectionHasProduct(collectionId: string): Promise<boolean> {
  const data = await adminGraphQL<{ node: { hasProduct: boolean } | null }>(HAS_PRODUCT_QUERY, {
    id: collectionId,
  });
  return data.node?.hasProduct ?? false;
}

const CODE_CREATE_MUTATION = `
  mutation CreateCode($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

function buildCode(season: SeasonConfig, startYear: number): string {
  return `${season.discount!.codeStem}-${startYear}`;
}

async function codeAlreadyExists(code: string): Promise<boolean> {
  const data = await adminGraphQL<{ codeDiscountNodeByCode: { id: string } | null }>(
    CODE_LOOKUP_QUERY,
    { code }
  );
  return data.codeDiscountNodeByCode !== null;
}

async function createDiscountCode(
  season: SeasonConfig,
  code: string,
  start: Date,
  end: Date
): Promise<void> {
  const discount = season.discount!;
  const input = {
    title: `${season.menuTitle} (${code})`,
    code,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    customerGets: {
      value: { percentage: discount.percentage },
      items:
        discount.scope === "storewide"
          ? { all: true }
          : { collections: { add: [season.collectionId] } },
    },
  };

  const result = await adminGraphQL<{
    discountCodeBasicCreate: {
      codeDiscountNode: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(CODE_CREATE_MUTATION, { input });

  if (result.discountCodeBasicCreate.userErrors.length > 0) {
    throw new Error(
      `discountCodeBasicCreate gav fel för ${code}: ${result.discountCodeBasicCreate.userErrors
        .map((e) => e.message)
        .join("; ")}`
    );
  }
}

export type SeasonalDiscountResult = {
  season: string;
  code: string;
  action: "created" | "already-existed" | "skipped-manual-year" | "skipped-no-products" | "error";
  error?: string;
};

export async function ensureSeasonalDiscounts(
  now: Date = new Date()
): Promise<SeasonalDiscountResult[]> {
  const results: SeasonalDiscountResult[] = [];

  for (const season of SEASONS) {
    if (!season.discount) continue;

    const { start, end, startYear } = currentOrNextWindow(season, now);
    const code = buildCode(season, startYear);

    if (season.skipDiscountForStartYear === startYear) {
      results.push({ season: season.key, code, action: "skipped-manual-year" });
      continue;
    }

    try {
      const exists = await codeAlreadyExists(code);
      if (exists) {
        results.push({ season: season.key, code, action: "already-existed" });
        continue;
      }
      if (season.discount.scope === "collection") {
        const hasProduct = await collectionHasProduct(season.collectionId);
        if (!hasProduct) {
          results.push({ season: season.key, code, action: "skipped-no-products" });
          continue;
        }
      }
      await createDiscountCode(season, code, start, end);
      results.push({ season: season.key, code, action: "created" });
    } catch (err) {
      results.push({
        season: season.key,
        code,
        action: "error",
        error: String((err as Error)?.message ?? err),
      });
    }
  }

  return results;
}
