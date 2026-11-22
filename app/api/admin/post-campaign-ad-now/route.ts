import { NextRequest, NextResponse } from "next/server";
import { postCampaignAdsIfDue } from "@/lib/campaignAds";

/**
 * "Testa kampanj-annons nu"-knappen på startsidan (app/page.tsx) -
 * samma ADMIN_SECRET-skydd som "Posta nästa produkt nu". Postar med
 * force:true, dvs. ignorerar "var tredje dag"-spärren så Christoffer
 * kan testa direkt utan att vänta på en riktig annonsdag - men
 * uppdaterar fortfarande staten (lib/campaignAds.ts), så den riktiga
 * cronen inte dubbelpostar samma dag igen.
 */
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

  try {
    const results = await postCampaignAdsIfDue({ force: true });
    if (results.length === 0) {
      return NextResponse.json({ skipped: "Ingen aktiv rabattkampanj hittades just nu." });
    }
    return NextResponse.json({
      posted: results.map((r) => ({
        campaign: r.campaign.title,
        instagram: r.instagram,
        instagramStory: r.instagramStory,
        facebook: r.facebook,
        facebookStory: r.facebookStory,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
