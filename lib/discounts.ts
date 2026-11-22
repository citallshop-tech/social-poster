import { adminGraphQL } from "./shopify";

// ============================================================================
// Hämtar aktiva, store-wide rabattkoder från Shopify - byggt 2026-11-22
// för kampanj-annonsfunktionen (se lib/campaignAds.ts). Separat modul
// från shopify.ts eftersom den där filen handlar om PRODUKTER, den här
// om RABATTER - men delar samma adminGraphQL()-hjälpare (och alltså
// samma token/autentisering) för att slippa duplicera det.
//
// Hämtar helt enkelt de 25 senast skapade koderna och filtrerar själva
// på startsAt/endsAt (ingen "query: status:active"-filtrering i
// GraphQL-anropet - osäkert om/hur codeDiscountNodes stödjer det, och
// vår egen datumkoll nedan behövs oavsett, så den extra filtreringen
// skulle bara vara en risk utan egentlig vinst).
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

interface CodeDiscountNodesResponse {
  codeDiscountNodes: {
    nodes: Array<{
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
    }>;
  };
}

const QUERY = `
  query ActiveCodeDiscounts {
    codeDiscountNodes(first: 25) {
      nodes {
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
  }
`;

/**
 * Alla store-wide rabattkoder som JUST NU faktiskt är inom sin
 * startsAt/endsAt-period (inte bara "status:active" enligt Shopifys
 * egen filtrering - vi räknar om det själva också som extra säkerhet).
 */
export async function getActiveDiscountCampaigns(): Promise<ActiveCampaign[]> {
  const data = await adminGraphQL<CodeDiscountNodesResponse>(QUERY);
  const now = Date.now();

  const result: ActiveCampaign[] = [];
  for (const node of data.codeDiscountNodes.nodes) {
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
      code: cd.codes?.nodes?.[0]?.code ?? null,
      startsAt: cd.startsAt,
      endsAt: cd.endsAt ?? null,
      percentage,
    });
  }
  return result;
}
