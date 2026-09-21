import { NextRequest, NextResponse } from "next/server";
import { postNextProduct } from "@/lib/autoPost";

/**
 * "Posta nästa produkt nu"-knappen på startsidan (app/page.tsx) anropar
 * den här routen. Skyddad med ADMIN_SECRET (skickas i body, inte i URL:en,
 * så den inte hamnar i webbläsarhistorik/loggar).
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
    const result = await postNextProduct();
    if ("skipped" in result) {
      return NextResponse.json(result);
    }
    return NextResponse.json({
      postedTitle: result.posted.title,
      instagram: result.instagram,
      facebook: result.facebook,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
