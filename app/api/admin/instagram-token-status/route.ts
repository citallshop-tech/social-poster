import { NextRequest, NextResponse } from "next/server";
import { refreshInstagramTokenIfNeeded } from "@/lib/instagramToken";

/**
 * Manuell koll av Instagram-tokenens status, utan att behöva vänta på
 * nästa dagliga cron-körning eller leta i Vercel Logs. Öppna i
 * webbläsaren, inloggad på ingenting särskilt (det här projektet har
 * ingen användarinloggning, bara Christoffer själv som ägare):
 *
 *   https://din-domän/api/admin/instagram-token-status?secret=<ADMIN_SECRET>
 *
 * Byt ut <ADMIN_SECRET> mot samma värde som ADMIN_SECRET-miljövariabeln.
 */
export async function GET(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "ADMIN_SECRET är inte satt." }, { status: 500 });
  }

  const provided = request.nextUrl.searchParams.get("secret");
  if (provided !== adminSecret) {
    return NextResponse.json({ error: "Fel secret." }, { status: 401 });
  }

  try {
    const result = await refreshInstagramTokenIfNeeded();
    return NextResponse.json({
      ...result,
      expiresAtReadable: new Date(result.expiresAt).toISOString(),
      hint:
        result.daysUntilExpiry > 15
          ? "Allt bra - gott om tid kvar."
          : "Nära utgång - kolla att den dagliga cron-jobbet faktiskt körts (Vercel → Logs, sök på \"[Instagram-token]\").",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
