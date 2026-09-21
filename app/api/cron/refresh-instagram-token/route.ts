import { NextRequest, NextResponse } from "next/server";
import { refreshInstagramTokenIfNeeded } from "@/lib/instagramToken";

/**
 * Körs automatiskt en gång om dagen av Vercel Cron (se vercel.json) för att
 * hålla Instagram-tokenen vid liv - se filkommentaren i
 * lib/instagramToken.ts för hela bakgrunden om varför det behövs.
 *
 * Skyddad med CRON_SECRET, samma mönster som cron-rutterna i Farvyo/
 * Meetrana ("Authorization: Bearer <CRON_SECRET>") - Vercel lägger
 * automatiskt till den headern på sina egna schemalagda anrop så länge en
 * miljövariabel som heter exakt CRON_SECRET finns satt i projektet.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET är inte satt i miljövariablerna." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Obehörig." }, { status: 401 });
  }

  try {
    const result = await refreshInstagramTokenIfNeeded();
    console.log(
      `[Instagram-token] ${
        result.refreshed ? "Förnyad" : "Ingen förnyelse behövdes"
      } - ${Math.round(result.daysUntilExpiry)} dagar kvar till utgång.`
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error(
      "[Instagram-token] Förnyelse misslyckades:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
