import { NextRequest, NextResponse } from "next/server";
import { syncSeasonalMenu } from "@/lib/menuSync";
import { ensureSeasonalDiscounts } from "@/lib/seasonalDiscounts";

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
    const menu = await syncSeasonalMenu();
    const discounts = await ensureSeasonalDiscounts();
    return NextResponse.json({ menu, discounts });
  } catch (err) {
    return NextResponse.json(
      { error: String((err as Error)?.message ?? err) },
      { status: 500 }
    );
  }
}
