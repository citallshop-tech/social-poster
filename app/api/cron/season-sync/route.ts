import { NextRequest, NextResponse } from "next/server";
import { syncSeasonalMenu } from "@/lib/menuSync";
import { ensureSeasonalDiscounts } from "@/lib/seasonalDiscounts";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET är inte satt." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Fel secret." }, { status: 401 });
  }

  try {
    const menu = await syncSeasonalMenu();
    const discounts = await ensureSeasonalDiscounts();
    return NextResponse.json({ menu, discounts });
  } catch (err) {
    console.error("[Social poster] Säsongs-synk misslyckades:", err);
    return NextResponse.json(
      { error: String((err as Error)?.message ?? err) },
      { status: 500 }
    );
  }
}
