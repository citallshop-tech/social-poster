import { put, head } from "@vercel/blob";
import crypto from "crypto";

// ============================================================================
// Automatisk förnyelse av Instagram-token — byggd 2026-09-16.
//
// Instagram Graph API:s "long-lived" access-tokens är ALDRIG permanenta -
// de går ut efter 60 dagar, oavsett om appen används eller inte. Meta
// erbjuder ett förnyelse-anrop (graph.instagram.com/refresh_access_token)
// som ger 60 dagar till, men BARA om tokenen är minst 24 timmar gammal och
// INTE redan gått ut - hinner man inte förnya i tid går tokenen inte att
// rädda, och hela Steg 2 i README (Instagram-inloggningen) måste göras om
// för att få en helt ny.
//
// Så här funkar det automatiska bygget:
//   1. En cron-rutt (app/api/cron/refresh-instagram-token/route.ts) körs en
//      gång om dagen (se vercel.json) och anropar
//      refreshInstagramTokenIfNeeded().
//   2. Så länge det är gott om tid kvar (mer än REFRESH_WINDOW_DAYS dagar
//      till utgång) görs ingenting - vi undviker att förnya i onödan.
//   3. När färre än REFRESH_WINDOW_DAYS dagar återstår hämtas en ny token
//      från Meta och sparas.
//   4. Den sparas i Vercel Blob (samma lagringstjänst som redan används i
//      det här projektet, BLOB_READ_WRITE_TOKEN) istället för en
//      miljövariabel - miljövariabler i Vercel går INTE att ändra från
//      körande kod, bara manuellt i Vercels dashboard. Blob är den enkla
//      lösningen som redan finns tillgänglig, utan att behöva sätta upp en
//      egen databas bara för det här.
//   5. Själva token-värdet krypteras innan det sparas (AES-256-GCM, med en
//      nyckel härledd från CRON_SECRET). Vercel Blob har idag bara "public"
//      åtkomst (ingen inloggningsskyddad läsning) - krypteringen är ett
//      extra skyddslager ifall någon någonsin skulle gissa/hitta
//      blob-URL:en. CRON_SECRET återanvänds som nyckel-källa så inget nytt
//      hemligt värde behöver skapas eller sparas separat.
//
// getValidInstagramAccessToken() är vad publiceringskoden (lib/instagram.ts,
// byggs i ett senare steg när Instagram-publiceringen skrivs) ska anropa -
// den garanterar alltid en giltig, ej utgången token, och förnyar
// automatiskt om det behövs. Använd INTE process.env.INSTAGRAM_ACCESS_TOKEN
// direkt någon annanstans i koden.
// ============================================================================

const TOKEN_BLOB_PATH = "social-poster/instagram-token.json";

/** Förnya när färre än så här många dagar återstår till utgång. Gott om
 * marginal (cron körs dagligen, så vi missar aldrig fönstret även om en
 * enstaka körning skulle misslyckas). */
const REFRESH_WINDOW_DAYS = 15;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000; // Metas krav för att få förnya alls.

// Instagram-tokenen i miljövariabeln INSTAGRAM_ACCESS_TOKEN skapades
// manuellt i Meta App Dashboard 2026-09-16 (se Social poster-
// statusdokumentet i Plattformer-projektet). Används BARA som
// utgångspunkt allra första gången koden körs, innan något finns sparat i
// Blob-lagringen än.
const INITIAL_TOKEN_CREATED_AT = Date.parse("2026-09-16T00:00:00Z");

type StoredToken = {
  accessToken: string;
  createdAt: number; // Unix-ms
  expiresAt: number; // Unix-ms
};

function getEncryptionKey(): Buffer {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error(
      "CRON_SECRET saknas - krävs både för att skydda cron-rutten och som krypteringsnyckel för den sparade Instagram-tokenen."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv + authTag + ciphertext, allt ihopslaget och base64-kodat - enkelt
  // att spara som text i en blob.
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decrypt(payload: string): string {
  const key = getEncryptionKey();
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function readStoredToken(): Promise<StoredToken | null> {
  try {
    const info = await head(TOKEN_BLOB_PATH);
    const res = await fetch(info.url, { cache: "no-store" });
    if (!res.ok) return null;
    const encrypted = await res.text();
    return JSON.parse(decrypt(encrypted)) as StoredToken;
  } catch {
    // Ingen sparad token än (första körningen någonsin) - inte ett fel.
    return null;
  }
}

async function writeStoredToken(token: StoredToken): Promise<void> {
  await put(TOKEN_BLOB_PATH, encrypt(JSON.stringify(token)), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain",
  });
}

function seedFromEnv(): StoredToken {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("INSTAGRAM_ACCESS_TOKEN saknas i miljövariablerna.");
  }
  return {
    accessToken,
    createdAt: INITIAL_TOKEN_CREATED_AT,
    expiresAt: INITIAL_TOKEN_CREATED_AT + SIXTY_DAYS_MS,
  };
}

/**
 * Ser till att den sparade Instagram-tokenen är giltig, och förnyar den
 * hos Meta om färre än REFRESH_WINDOW_DAYS dagar återstår. Kallas av den
 * dagliga cron-rutten - men går också bra att anropa direkt innan en
 * publicering, som extra säkerhet.
 *
 * Kastar ett tydligt fel om tokenen redan hunnit gå ut helt (går INTE att
 * förnya då - kräver att Steg 2 i README görs om manuellt för en helt ny
 * token).
 */
export async function refreshInstagramTokenIfNeeded(): Promise<{
  refreshed: boolean;
  expiresAt: number;
  daysUntilExpiry: number;
}> {
  const current = (await readStoredToken()) ?? seedFromEnv();
  const now = Date.now();
  const daysUntilExpiry = (current.expiresAt - now) / (24 * 60 * 60 * 1000);

  if (current.expiresAt <= now) {
    throw new Error(
      "Instagram-tokenen har redan gått ut och kan INTE förnyas automatiskt längre. " +
        "Måste göras om manuellt: README.md Steg 2 (generera en ny token i Meta App Dashboard), " +
        "spara den som INSTAGRAM_ACCESS_TOKEN i Vercel, och gör en ny deploy - koden fångar då " +
        "upp den nya tokenen igen automatiskt nästa gång cron-rutten körs."
    );
  }

  if (daysUntilExpiry > REFRESH_WINDOW_DAYS) {
    // Gott om tid kvar. Spara ändå om det här var allra första körningen
    // (seedad från miljövariabeln) så att nästa körning läser från Blob
    // istället för att räkna om från INITIAL_TOKEN_CREATED_AT varje gång.
    const alreadyStored = await readStoredToken();
    if (!alreadyStored) {
      await writeStoredToken(current);
    }
    return { refreshed: false, expiresAt: current.expiresAt, daysUntilExpiry };
  }

  if (now - current.createdAt < MIN_TOKEN_AGE_MS) {
    // Osannolikt i praktiken (skulle bara hända om REFRESH_WINDOW_DAYS
    // någonsin sätts till mer än 59), men Meta kräver minst 24 timmar
    // gammal token för att tillåta förnyelse.
    return { refreshed: false, expiresAt: current.expiresAt, daysUntilExpiry };
  }

  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(
      current.accessToken
    )}`
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "(kunde inte läsa svaret)");
    throw new Error(
      `Kunde inte förnya Instagram-token: HTTP ${res.status} - ${bodyText.slice(0, 500)}`
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const updated: StoredToken = {
    accessToken: data.access_token,
    createdAt: now,
    expiresAt: now + data.expires_in * 1000,
  };
  await writeStoredToken(updated);

  return {
    refreshed: true,
    expiresAt: updated.expiresAt,
    daysUntilExpiry: data.expires_in / (24 * 60 * 60),
  };
}

/**
 * Hämtar en garanterat giltig Instagram-token - förnyar automatiskt om
 * det behövs. Det här är vad lib/instagram.ts (publiceringskoden, byggs
 * senare) ska använda - INTE process.env.INSTAGRAM_ACCESS_TOKEN direkt.
 */
export async function getValidInstagramAccessToken(): Promise<string> {
  await refreshInstagramTokenIfNeeded();
  const current = await readStoredToken();
  if (!current) {
    // Ska inte kunna hända (refreshInstagramTokenIfNeeded sparar alltid
    // undan ett resultat), men faller tillbaka på miljövariabeln som sista
    // utväg hellre än att krascha.
    return seedFromEnv().accessToken;
  }
  return current.accessToken;
}
