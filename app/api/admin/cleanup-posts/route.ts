import { NextRequest, NextResponse } from "next/server";

const GRAPH_VERSION = "v21.0";

// ============================================================================
// ENGÅNGS-STÄDRUTT, byggd 2026-11-22 efter en bugg i kampanj-annons-
// funktionen (lib/campaignAds.ts) som postade annonser för Loox-
// värvningskoder och andra interna koder istället för bara riktiga
// butikskampanjer. De här ID:na är exakt de inlägg/stories som skapades
// av det felaktiga testet (se chatten med Claude 2026-11-22) - listan
// är hårdkodad eftersom det här är en engångsstädning, inte en
// återanvändbar funktion. Säkert att köra flera gånger - redan
// borttagna/okända ID:n ger bara ett FEL-resultat för just den raden,
// stoppar inte resten.
// ============================================================================

const FACEBOOK_FEED_POST_IDS = [
  "423246450880064_122236944668571012",
  "423246450880064_122236944824571012",
  "423246450880064_122236945034571012",
  "423246450880064_122236945208571012",
  "423246450880064_122236945382571012",
  "423246450880064_122236945628571012",
  "423246450880064_122236945772571012",
  "423246450880064_122236945982571012",
  "423246450880064_122236946204571012",
  "423246450880064_122236946450571012",
  "423246450880064_122236946618571012",
  "423246450880064_122236946834571012",
  "423246450880064_122236947002571012",
  "423246450880064_122236947176571012",
  "423246450880064_122236947446571012",
  "423246450880064_122236947632571012",
  "423246450880064_122236947788571012",
  "423246450880064_122236947998571012",
  "423246450880064_122236948466571012",
  "423246450880064_122236948760571012",
  "423246450880064_122236948922571012",
  "423246450880064_122236949150571012",
  "423246450880064_122236949336571012",
  "423246450880064_122236949630571012",
];

const FACEBOOK_STORY_IDS = [
  "1166919525871747",
  "1415890506979346",
  "1171648075816851",
  "1168075462366964",
  "1487734033227460",
  "2752976701786228",
  "2987090541648309",
  "2443953409766133",
  "1670729017862186",
  "2192572225469662",
  "2143785902938899",
  "1774388430295546",
  "1449085077357799",
  "1656636742788403",
  "1134919742760047",
  "1152244753963046",
  "1649760326885862",
  "27663519583346251",
  "1513742017315044",
  "1790775355359457",
  "1448218940826169",
  "30370445492542287",
  "1772418720533390",
  "1644583164016471",
];

// Instagram tillåter oss sannolikt INTE att ta bort publicerad media via
// API:et (ingen dokumenterad delete-endpoint för Content Publishing API) -
// försöker ändå, men räkna med att dessa behöver tas bort för hand i
// Instagram-appen om de misslyckas (se svaret från den här routen).
const INSTAGRAM_MEDIA_IDS = [
  "18110595224526429",
  "18108792800377007",
  "18160321600523163",
  "18123346009767216",
  "17891979270479170",
  "18116806460144342",
];

type CleanupResult = { id: string; ok: boolean; detail: string };

async function deleteFacebookObject(id: string, token: string): Promise<CleanupResult> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${id}?access_token=${encodeURIComponent(token)}`,
      { method: "DELETE" }
    );
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      return { id, ok: false, detail: `HTTP ${res.status}: ${bodyText.slice(0, 200)}` };
    }
    return { id, ok: true, detail: bodyText.slice(0, 100) };
  } catch (err) {
    return { id, ok: false, detail: String((err as Error)?.message ?? err) };
  }
}

async function deleteInstagramMedia(id: string, token: string): Promise<CleanupResult> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/${GRAPH_VERSION}/${id}?access_token=${encodeURIComponent(token)}`,
      { method: "DELETE" }
    );
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      return { id, ok: false, detail: `HTTP ${res.status}: ${bodyText.slice(0, 200)}` };
    }
    return { id, ok: true, detail: bodyText.slice(0, 100) };
  } catch (err) {
    return { id, ok: false, detail: String((err as Error)?.message ?? err) };
  }
}

export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "ADMIN_SECRET är inte satt." }, { status: 500 });
  }
  const body = await request.json().catch(() => null);
  const provided = typeof body?.secret === "string" ? body.secret : "";
  if (provided !== adminSecret) {
    return NextResponse.json({ error: "Fel secret." }, { status: 401 });
  }

  const fbToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!fbToken) {
    return NextResponse.json({ error: "FACEBOOK_PAGE_ACCESS_TOKEN saknas." }, { status: 500 });
  }

  const facebookResults: CleanupResult[] = [];
  for (const id of [...FACEBOOK_FEED_POST_IDS, ...FACEBOOK_STORY_IDS]) {
    facebookResults.push(await deleteFacebookObject(id, fbToken));
  }

  const instagramResults: CleanupResult[] = [];
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN; // bara om satt direkt - annars hoppas över
  if (igToken) {
    for (const id of INSTAGRAM_MEDIA_IDS) {
      instagramResults.push(await deleteInstagramMedia(id, igToken));
    }
  }

  return NextResponse.json({
    facebook: {
      totalAttempted: facebookResults.length,
      ok: facebookResults.filter((r) => r.ok).length,
      failed: facebookResults.filter((r) => !r.ok),
    },
    instagram: igToken
      ? {
          totalAttempted: instagramResults.length,
          ok: instagramResults.filter((r) => r.ok).length,
          failed: instagramResults.filter((r) => !r.ok),
        }
      : { skipped: "Ingen giltig Instagram-token tillgänglig just nu - ta bort dessa 6 inlägg för hand i Instagram-appen istället." },
  });
}
