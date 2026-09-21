# Auto-postare — C it all store

Hämtar produkter från valda Shopify-kollektioner och postar dem
automatiskt till Instagram, en produkt per dag, helt gratis (inget
annonskonto, ingen löpande kostnad förutom Vercels gratisnivå).

Bygger på att du **äger** Instagram-kontot själv - det kräver inget
godkännande från Meta (App Review), bara att du lägger till dig själv
som "Tester" på din egen app. Se steg 2 nedan.

## Steg 1 — Shopify Admin API (Client ID + secret)

Shopify tog bort det gamla "Develop apps"-flödet (den permanenta
`shpat_...`-token) den 1 januari 2026. Nya appar skapas istället i Dev
Dashboard och får ett Client ID + Client secret - appen hämtar sedan
själv en tillfällig token (giltig 24 timmar) via "client credentials
grant". Koden i `lib/shopify.ts` gör redan det automatiskt, du behöver
bara skaffa själva ID:t och hemligheten:

1. Gå till **dev.shopify.com/dashboard** i webbläsaren, inloggad med
   samma konto som äger citall.store
2. Klicka **Apps** i vänstermenyn → **Create app** uppe till höger →
   **Start from Dev Dashboard**
3. Döp appen, t.ex. `citall-instagram` → **Create**
4. Gå till fliken **Versions** → skapa en ny version → under
   **Configuration**/scopes, ge den läsbehörighet till **Products**
   (`read_products`)
5. Koppla appen till din butik (organisationens egen butik, inte en
   kunds - se not längre ner) och installera den
6. Under appens inställningar hittar du **Client ID** och
   **Client secret** - det är `SHOPIFY_CLIENT_ID` respektive
   `SHOPIFY_CLIENT_SECRET`
7. `SHOPIFY_STORE_DOMAIN` är din `xxxxx.myshopify.com`-adress (syns i
   webbläsarens adressfält när du är inloggad i adminet)
8. `SHOPIFY_PUBLIC_DOMAIN` är din riktiga, publika adress: `citall.store`

**Viktigt att veta:** client credentials-flödet ovan fungerar bara för
butiker i din egen Shopify-organisation - inte för en framtida kunds
butik om det här någon gång byggs om till en tjänst andra kan använda.
Den dagen krävs istället en publik app med OAuth (authorization code
grant) där varje kund godkänner installationen själv. Inget att bygga
nu, bara bra att känna till innan man planerar en sådan utbyggnad.

## Steg 2 — Instagram, utan att vänta på godkännande

Det här är den mest tekniska biten, men går på under en timme eftersom
du bara kopplar ditt EGET konto - inget godkännande krävs.

1. Se till att ditt Instagram-konto är ett **Business**- eller
   **Creator**-konto (Instagram-appen → Inställningar → Konto → byt
   kontotyp om det står "Privat konto")
2. Koppla Instagram-kontot till en **Facebook-sida** (skapa en gratis
   Facebook-sida för butiken om du inte har en, sen Instagram-appen →
   Inställningar → Konto → Länkade konton → Facebook)
3. Gå till **developers.facebook.com** → logga in → **My Apps** →
   **Create App** → välj typ **"Business"**
4. I appen, lägg till produkten **"Instagram"** (Graph API)
5. Gå till **App roles → Roles** → lägg till **dig själv** som
   **Instagram Tester**
6. Öppna Instagram-appen på din telefon → du får en inbjudan att
   acceptera "Tester"-rollen → acceptera den
7. Tillbaka på developers.facebook.com, använd **Graph API Explorer**
   (finns i menyn) för att generera en access-token med behörigheterna
   `instagram_business_basic` och `instagram_business_content_publish`
8. Kopiera den token som visas - det är `INSTAGRAM_ACCESS_TOKEN`
   (long-lived, håller i 60 dagar - se avsnittet "Automatisk förnyelse
   av Instagram-token" nedan för hur den sedan hålls vid liv utan
   manuellt arbete)
9. `INSTAGRAM_BUSINESS_ACCOUNT_ID` hittar du genom att i samma Graph
   API Explorer köra en förfrågan mot `me/accounts`, sen mot
   `{sid-id}?fields=instagram_business_account` - eller fråga mig så
   hjälper jag dig läsa av rätt siffra när du är där.

## Automatisk förnyelse av Instagram-token (byggd 2026-09-16)

Instagram-tokenen ovan är **aldrig permanent** - Meta gör att den går
ut efter 60 dagar, oavsett om appen används eller inte. Hinner ingen
förnya den i tid går den inte att rädda, och hela Steg 2 måste göras om
för att få en helt ny.

För att slippa komma ihåg det manuellt varannan månad sköter
`lib/instagramToken.ts` + `app/api/cron/refresh-instagram-token/route.ts`
det här automatiskt:

- En **cron-rutt körs en gång om dagen** (se `vercel.json`, kl 03:00
  UTC) och kollar hur många dagar som är kvar till utgång.
- När färre än 15 dagar återstår hämtas automatiskt en ny 60-dagars-
  token från Meta och sparas - i god tid innan den gamla hinner gå ut.
- Den sparas i **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`, samma
  lagringstjänst som redan används i det här projektet) istället för i
  en miljövariabel, eftersom miljövariabler i Vercel bara kan ändras
  manuellt i dashboarden, inte från körande kod.
- Token-värdet **krypteras** innan det sparas (med `CRON_SECRET` som
  nyckel-källa), som ett extra skydd eftersom Vercel Blob idag bara har
  offentlig (inte inloggningsskyddad) läsning av filer.

**Vad krävs av dig:** ingenting löpande. Så fort projektet är
driftsatt (Steg 3 nedan) och `CRON_SECRET` finns satt, sköter cron-
rutten sig själv för alltid - så länge Vercel-projektet lever och
`INSTAGRAM_ACCESS_TOKEN` någon gång var giltig när den sattes första
gången.

**Om tokenen ändå hinner gå ut helt** (t.ex. om cron-rutten skulle
sluta köras av någon anledning under en längre period): den går INTE
att rädda automatiskt då. Gör om Steg 2 ovan för att få en helt ny
token, spara den som `INSTAGRAM_ACCESS_TOKEN` i Vercel, och gör en ny
Redeploy - koden fångar då upp den nya tokenen igen automatiskt.

**Kolla statusen när som helst** (utan att vänta på nästa cron-körning
eller leta i loggar) genom att öppna, inloggad på ingenting särskilt:

```
https://din-domän/api/admin/instagram-token-status?secret=<ADMIN_SECRET>
```

Byt ut `<ADMIN_SECRET>` mot samma värde som `ADMIN_SECRET`-
miljövariabeln. Svaret visar hur många dagar som är kvar till utgång.

## Steg 3 — Driftsättning (samma mönster som Velvetine)

1. Skapa ett nytt repo på GitHub, döp det t.ex. `social-poster`
2. `git init`, `git add .`, `git commit -m "Auto-postare"`, koppla till
   GitHub-repot, `git push`
3. Vercel → **Add New → Project** → importera det nya repot
4. **Innan Deploy**: lägg in alla variabler från `.env.example` i
   Environment Variables - inklusive en egen `BLOB_READ_WRITE_TOKEN`
   (Storage-fliken i Vercel → Create → Blob, eller återanvänd samma
   token som Velvetine redan har)
5. Hitta på egna lösenord för `CRON_SECRET` och `ADMIN_SECRET` - vilka
   slumpade tecken som helst duger (CRON_SECRET används numera även
   som krypteringsnyckel för den sparade Instagram-tokenen, se ovan -
   inget extra steg behövs för det, bara att den faktiskt är satt)
6. Sätt `AUTO_POST_COLLECTIONS` till dina kollektioners handle,
   kommaseparerat (t.ex. `hemma,kontor`)
7. Deploy

Så fort deployen är klar börjar den dagliga token-förnyelsen (kl 03:00
UTC) att köra sig själv - inget mer du behöver göra för den delen.

## Hur det körs

Vercel postar automatiskt **en produkt per dag, kl 10:00 UTC**
(runt 11-12 svensk tid) - inget du behöver göra. Ändra tiden i
`vercel.json` om du vill ha ett annat klockslag. (OBS: själva
postnings-koden och cron-rutten för det är INTE byggd än - bara
Instagram-token-förnyelsen ovan. Se Plattformer-projektets
statusdokument för Social poster för vad som återstår.)

Vill du testa direkt utan att vänta på schemat: gå till sajtens
startsida, skriv in ditt `ADMIN_SECRET`, klicka "Posta nästa produkt
nu". (Den knappen är heller inte byggd än.)

## Vad den INTE gör

- Postar inte till Pinterest eller andra plattformar än Instagram -
  Pinterest har en liknande men separat process, säg till om du vill
  bygga det också
- Skriver inte AI-genererade bildtexter (för att slippa behöva ännu
  ett API-konto) - texten byggs istället direkt av produktens namn,
  beskrivning och pris. Säg till om du hellre vill koppla in AI-texter
  (kräver en egen Anthropic API-nyckel eftersom det här är en
  fristående app, inte en Claude-artifact)
- Postar bara **en** bild per produkt (den första produktbilden), inte
  karuseller med flera bilder
