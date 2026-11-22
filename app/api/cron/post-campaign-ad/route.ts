import { NextRequest, NextResponse } from "next/server";
import { postCampaignAdsIfDue } from "@/lib/campaignAds";

/**
 * Körs automatiskt en gång om dagen av Vercel Cron (se vercel.json) -
 * kollar om någon aktiv rabattkampanj har en "annonsdag" idag (var 3:e
 * dag sedan kampanjens start, se lib/campaignAds.ts) och postar då ett
 * extra annonsinlägg (fyra kanaler: Instagram-flöde, Instagram-story,
 * Facebook-flöde, Facebook-story) för den kampanjen. Separat cron-rutt
 * från den vanliga produktrotationen (/api/cron/post-daily) - byggd
 * 2026-11-22 på Christoffers begäran ("Periodiska 'annons'-inlägg under
 * kampanjerna som var tredje dag under annons perioden"). Skyddad med
 * CRON_SECRET, samma mönster som post-daily.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET är inte satt." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Obehörig." }, { status: 401 });
  }

  try {
    const results = await postCampaignAdsIfDue();
    if (results.length === 0) {
      return NextResponse.json({ skipped: "Ingen kampanj hade en annonsdag idag." });
    }

    for (const r of results) {
      const channels = [
        ["Instagram-flöde", r.instagram],
        ["Instagram-story", r.instagramStory],
        ["Facebook-flöde", r.facebook],
        ["Facebook-story", r.facebookStory],
      ] as const;
      for (const [name, ch] of channels) {
        if (ch.ok) {
          console.log(
            `[Social poster] Kampanj-annons "${r.campaign.title}" postad till ${name} (id ${ch.id}).`
          );
        } else {
          console.error(
            `[Social poster] Kampanj-annons "${r.campaign.title}" - ${name} misslyckades: ${ch.error}`
          );
        }
      }
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
    console.error(
      "[Social poster] Kampanj-annons misslyckades:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
