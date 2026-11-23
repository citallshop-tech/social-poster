import { adminGraphQL } from "./shopify";

// ============================================================================
// Hämtar aktiva, store-wide rabattkoder från Shopify - för kampanj-
// annonsfunktionen (se lib/campaignAds.ts).
//
// FIXAD 2026-11-23 (allvarlig bugg): den gamla versionen hämtade helt
// enkelt de 25 först skapade `codeDiscountNodes` och antog att "inom sitt
// datumfönster" = "en riktig kampanj värd att annonsera". I praktiken
// innehåller butiken massor av koder som INTE är riktiga kampanjer och
// som ALDRIG tar slut (endsAt: null) - gamla testkoder ("Freeshippingpls",
// "offentireorder"), och framför allt dussintals Loox-"Friend Discount"-
// värvningskoder som skapas automatiskt för varje kundrecension. Alla
// dessa såg ut som "aktiva kampanjer" för den gamla koden och postades
// som riktiga annonser till Instagram/Facebook - exakt samma bugg som
// städades upp manuellt 2026-11-22 (se app/api/admin/cleanup-posts),
// men grundorsaken i DENNA fil fixades aldrig då, så den återkom
// (upptäckt igen av Christoffer 2026-11-23).
//
// NY METOD: bara koder som EXPLICIT listas i miljövariabeln
// CAMPAIGN_AD_CODES (kommaseparerad, t.ex. "BLACKFRIDAY20,JUL10") kan
// någonsin annonseras. Varje kod slås upp direkt med Shopifys egen
// `codeDiscountNodeByCode`-query (exakt kod-matchning) istället för att
// gissa utifrån en lista på "senast skapade" koder - då spelar det ingen
// roll hur många Loox-koder eller andra interna koder som finns, de kan
// aldrig av misstag plockas upp.
// ============================================================================

export interface ActiveCampaign {
  id: string;
  title: string;
  code: string | null;
  startsAt: string;
  endsAt: string | null;
  /** Procent som ett vanligt heltal (20 = 20%), null om det inte går att läsa ut (t.ex. fri frakt eller Köp X Få Y). */
  percentage: number | null;
}

interface CodeDiscountNodeByCodeResponse {
  codeDiscountNodeByCode: {
    id: string;
    codeDiscount: {
      __typename: string;
      title: string;
      status: string;
      startsAt: string;
      endsAt: string | null;
      codes?: { nodes?: Array<{ code: string }> };
      customerGets?: {
        value?: {
          __typename: string;
          percentage?: number;
        };
      };
    };
  } | null;
}

const QUERY = `
  query CodeDiscountByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          startsAt
          endsAt
          codes(first: 1) { nodes { code } }
          customerGets {
            value {
              __typename
              ... on DiscountPercentage { percentage }
            }
          }
        }
        ... on DiscountCodeFreeShipping {
          title
          status
          startsAt
          endsAt
          codes(first: 1) { nodes { code } }
        }
        ... on DiscountCodeBxgy {
          title
          status
          startsAt
          endsAt
          codes(first: 1) { nodes { code } }
        }
      }
    }
  }
`;

function getAllowlistedCodes(): string[] {
  const raw = process.env.CAMPAIGN_AD_CODES;
  if (!raw) return [];
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Alla EXPLICIT tillåtna rabattkoder (CAMPAIGN_AD_CODES) som JUST NU
 * faktiskt är inom sin startsAt/endsAt-period. Koder som inte finns i
 * CAMPAIGN_AD_CODES kan aldrig komma med här, oavsett vad som finns i
 * butiken i övrigt (Loox-värvningskoder, gamla testkoder, m.m.) - se
 * kommentaren högst upp i filen.
 */
export async function getActiveDiscountCampaigns(): Promise<ActiveCampaign[]> {
  const allowlist = getAllowlistedCodes();
  if (allowlist.length === 0) {
    console.warn(
      "[Social poster] CAMPAIGN_AD_CODES är tom/saknas - ingen kampanj-annons kan postas förrän den sätts (se lib/discounts.ts)."
    );
    return [];
  }

  const now = Date.now();
  const result: ActiveCampaign[] = [];

  for (const code of allowlist) {
    const data = await adminGraphQL<CodeDiscountNodeByCodeResponse>(QUERY, { code });
    const node = data.codeDiscountNodeByCode;
    if (!node) {
      console.warn(`[Social poster] Hittade ingen rabattkod som matchar "${code}" i CAMPAIGN_AD_CODES.`);
      continue;
    }

    const cd = node.codeDiscount;
    const startMs = new Date(cd.startsAt).getTime();
    const endMs = cd.endsAt ? new Date(cd.endsAt).getTime() : null;

    if (Number.isNaN(startMs) || startMs > now) continue; // inte börjat än (eller trasigt datum)
    if (endMs !== null && endMs <= now) continue; // redan slut

    let percentage: number | null = null;
    if (cd.__typename === "DiscountCodeBasic") {
      const value = cd.customerGets?.value;
      if (value?.__typename === "DiscountPercentage" && typeof value.percentage === "number") {
        percentage = Math.round(value.percentage * 100);
      }
    }

    result.push({
      id: node.id,
      title: cd.title,
      code: cd.codes?.nodes?.[0]?.code ?? code,
      startsAt: cd.startsAt,
      endsAt: cd.endsAt ?? null,
      percentage,
    });
  }

  return result;
}
