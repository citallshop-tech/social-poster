import { NextRequest, NextResponse } from "next/server";
import { postNextProduct } from "@/lib/poster";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await postNextProduct();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Cron-postning misslyckades:", err);
    return NextResponse.json(
      { posted: false, reason: err instanceof Error ? err.message : "Okänt fel" },
      { status: 500 }
    );
  }
}
