import { NextResponse } from "next/server";
import { getLastPostedProductUrl } from "@/lib/autoPost";

/**
 * "Länk i bio"-redirecten (byggd 2026-11-22). Instagram-profilens bio-länk
 * pekas EN gång (manuellt, i Instagram-appen: Redigera profil -> Länk) mot
 * den här adressen - efter det behöver bio-länken aldrig ändras för hand
 * igen. Varje besök skickas automatiskt vidare till vad som helst som
 * postades senast av den dagliga Instagram/Facebook-postningen, så "länk i
 * bio" i bildtexten alltid stämmer med den produkt som faktiskt visas.
 *
 * Bakgrund: en länk i en vanlig Instagram-bildtext går inte att klicka på
 * (plattformsbegränsning, se lib/instagram.ts), och Instagrams Content
 * Publishing-API tillåter inte en klickbar länk-sticker på Stories heller -
 * bio-länken är den enda klickbara platsen Instagram ger en affärsprofil.
 *
 * force-dynamic: måste alltid läsa det senaste från Vercel Blob, aldrig
 * cachas statiskt av Next.js.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const url = await getLastPostedProductUrl();
  return NextResponse.redirect(url, { status: 302 });
}
