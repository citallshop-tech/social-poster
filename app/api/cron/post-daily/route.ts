import { NextRequest, NextResponse } from "next/server";
import { postNextProduct } from "@/lib/autoPost";

/**
 * Körs automatiskt en gång om dagen av Vercel Cron (se vercel.json, kl
 * 10:00 UTC ≈ 11-12 svensk tid) - postar nästa produkt i turordning till
 * BÅDE Instagram och Facebook (byggt 2026-09-17). Skyddad med
 * CRON_SECRET, samma mönster som övriga cron-rutter i det här projektet
 * och i Farvyo/Meetrana.
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
      console.warn(`[Social poster] Hoppade över dagens postning: ${result.skipped}`);
      return NextResponse.json(result);
    }
    if (result.instagram.ok) {
      console.log(`[Social poster] Postade "${result.posted.title}" till Instagram (media-id ${result.instagram.id}).`);
    } else {
      console.error(`[Social poster] Instagram-postning misslyckades: ${result.instagram.error}`);
    }
    if (result.facebook.ok) {
      console.log(`[Social poster] Postade "${result.posted.title}" till Facebook (post-id ${result.facebook.id}).`);
    } else {
      console.error(`[Social poster] Facebook-postning misslyckades: ${result.facebook.error}`);
    }
    return NextResponse.json({
      postedTitle: result.posted.title,
      instagram: result.instagram,
      facebook: result.facebook,
    });
  } catch (err) {
    console.error(
      "[Social poster] Daglig postning misslyckades:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
