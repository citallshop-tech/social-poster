import { NextRequest, NextResponse } from "next/server";
import { postNextProduct } from "@/lib/poster";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Fel lösenord." }, { status: 401 });
  }

  try {
    const result = await postNextProduct();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Manuell postning misslyckades:", err);
    return NextResponse.json(
      { posted: false, reason: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
