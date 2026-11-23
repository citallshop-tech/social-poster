import { NextRequest, NextResponse } from "next/server";
import { postNextProduct } from "@/lib/autoPost";

/**
 * Körs automatiskt tre gånger om dagen av Vercel Cron (se vercel.json,
 * uppdaterat 2026-11-22 från 1x/dag till 3x/dag på Christoffers begäran) -
 * postar nästa produkt i turordning till Instagram-flödet, Instagram-story,
 * Facebook-flödet OCH Facebook-story (byggt 2026-09-17, story-stödet
 * tillagt 2026-11-22). Skyddad med CRON_SECRET, samma mönster som övriga
 * cron-rutter i det här projektet och i Farvyo/Meetrana.
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
    const result = await postNextProduct();
    if ("skipped" in result) {
      console.warn(`[Social poster] Hoppade över postningen: ${result.skipped}`);
      return NextResponse.json(result);
    }

    const channels = [
      ["Instagram-flöde", result.instagram],
      ["Instagram-story", result.instagramStory],
      ["Facebook-flöde", result.facebook],
      ["Facebook-story", result.facebookStory],
    ] as const;

    for (const [name, r] of channels) {
      if (r.ok) {
        console.log(`[Social poster] Postade "${result.posted.title}" till ${name} (id ${r.id}).`);
      } else {
        console.error(`[Social poster] ${name}-postning misslyckades: ${r.error}`);
      }
    }

    if (!result.stateSaved) {
      console.error(
        `[Social poster] VARNING: posting-state sparades INTE (${result.stateSaveError ?? "okänt fel"}). ` +
          `Samma produkt ("${result.posted.title}") kommer väljas igen nästa körning tills detta är löst.`
      );
    }

    return NextResponse.json({
      postedTitle: result.posted.title,
      instagram: result.instagram,
      instagramStory: result.instagramStory,
      facebook: result.facebook,
      facebookStory: result.facebookStory,
      stateSaved: result.stateSaved,
      stateSaveError: result.stateSaveError,
    });
  } catch (err) {
    console.error(
      "[Social poster] Postningen misslyckades:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
