// ============================================================================
// Säsongs-/högtidshanteraren — byggd 2026-11-22 på Christoffers begäran:
// varje säsongs-/högtidskollektion ska synas som en egen rad direkt i
// huvudmenyn ENDAST när den är "aktuell", och en matchande rabattkod ska
// vara aktiv under exakt samma period - "bra tajmat med allt".
//
// Allt datumarbete ligger samlat här. Två typer av period:
//   - "fixed": samma kalenderdatum varje år (t.ex. jul = 1-24 dec).
//   - "moving": räknas ut varje år efter en regel (påskdagen, midsommarafton,
//     N:te veckodagen i en månad) - behöver ALDRIG matas in för hand, någonsin.
//
// Vinter och Nyår spänner över årsskiftet (t.ex. 1 dec -> 28 feb) - start och
// slut ligger då i olika kalenderår, vilket hanteras explicit nedan.
// ============================================================================

export type SeasonDiscount = {
  /** Kodens "stam", t.ex. "HALLOWEEN15" - det fullständiga koden blir STAM-ÅR (t.ex. HALLOWEEN15-2027). */
  codeStem: string;
  /** Procent som decimaltal, t.ex. 0.15 för 15%. */
  percentage: number;
  /** "storewide" = gäller hela butiken. "collection" = gäller bara den här säsongens egna kollektion. */
  scope: "storewide" | "collection";
};

type FixedWindow = {
  kind: "fixed";
  startMonth: number; // 1-12
  startDay: number;
  endMonth: number; // 1-12
  endDay: number;
};

type MovingWindow = {
  kind: "moving";
  /** Räknar ut "högtidsdagen" (t.ex. påskdagen) för ett givet år. */
  anchor: (year: number) => Date;
  daysBefore: number;
  daysAfter: number;
};

export type SeasonConfig = {
  key: string;
  /** Titel som ska synas i menyn. */
  menuTitle: string;
  collectionId: string; // Shopify GID
  collectionHandle: string;
  window: FixedWindow | MovingWindow;
  discount: SeasonDiscount | null;
  /**
   * ENGÅNGS-UNDANTAG: hoppa över automatisk rabattskapande för ett specifikt
   * startår, eftersom den rabatten redan skapades FÖR HAND innan den här
   * automatiken byggdes (se claude/citall-store-sasongsplan-rabatter.md).
   * Från och med nästa förekomst sköter automatiken allt själv som vanligt.
   */
  skipDiscountForStartYear?: number;
};

// ----------------------------------------------------------------------------
// Datummatematik - rena funktioner, inget nätverk, inget state.
// ----------------------------------------------------------------------------

/** Påskdagen (gregoriansk kalender), Meeus/Jones/Butcher-algoritmen. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthDay = h + l - 7 * m + 114;
  const month = Math.floor(monthDay / 31); // 3 = mars, 4 = april
  const day = (monthDay % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Midsommarafton: fredagen mellan 19 och 25 juni. */
export function midsummerEve(year: number): Date {
  for (let day = 19; day <= 25; day++) {
    const d = new Date(Date.UTC(year, 5, day)); // juni = månad 5 (0-indexerat)
    if (d.getUTCDay() === 5) return d; // fredag = 5
  }
  throw new Error("Hittade ingen fredag mellan 19-25 juni - borde vara omöjligt.");
}

/**
 * N:te förekomsten av en veckodag i en månad (0 = söndag ... 6 = lördag).
 * n >= 1: den n:te förekomsten (1 = första). n === -1: den SISTA förekomsten.
 */
export function nthWeekdayOfMonth(year: number, month1to12: number, weekday: number, n: number): Date {
  const monthIndex0 = month1to12 - 1;
  if (n > 0) {
    const first = new Date(Date.UTC(year, monthIndex0, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    const day = 1 + offset + (n - 1) * 7;
    return new Date(Date.UTC(year, monthIndex0, day));
  }
  // Sista förekomsten: utgå från sista dagen i månaden och räkna bakåt.
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, monthIndex0, lastDayOfMonth));
  const diff = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, monthIndex0, lastDayOfMonth - diff));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Datumintervallet (konkreta datum) för en given säsong, "ankrat" till ett visst år. */
function windowForYear(config: SeasonConfig, year: number): { start: Date; end: Date } {
  const w = config.window;
  if (w.kind === "fixed") {
    const start = new Date(Date.UTC(year, w.startMonth - 1, w.startDay));
    // Om slutmånaden är tidigare än startmånaden (eller samma månad men tidigare dag)
    // spänner perioden över årsskiftet, t.ex. vinter (dec -> feb).
    const wraps =
      w.endMonth < w.startMonth || (w.endMonth === w.startMonth && w.endDay < w.startDay);
    const end = new Date(Date.UTC(wraps ? year + 1 : year, w.endMonth - 1, w.endDay));
    return { start, end };
  }
  const anchor = w.anchor(year);
  return { start: addDays(anchor, -w.daysBefore), end: addDays(anchor, w.daysAfter) };
}

/**
 * Perioden som antingen pågår just nu, eller (om ingen pågår) nästa kommande
 * förekomst - används för att veta vilket år/period en rabattkod ska skapas för.
 */
export function currentOrNextWindow(
  config: SeasonConfig,
  now: Date = new Date()
): { start: Date; end: Date; startYear: number } {
  const candidateYears = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];
  const windows = candidateYears.map((y) => ({ year: y, ...windowForYear(config, y) }));
  // Första fönstret vars slut inte redan har passerat.
  const upcoming = windows
    .filter((win) => win.end.getTime() >= now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const chosen = upcoming ?? windows[windows.length - 1];
  return { start: chosen.start, end: chosen.end, startYear: chosen.year };
}

/** Är den här säsongen aktiv just nu (ska synas i menyn)? */
export function isSeasonActive(config: SeasonConfig, now: Date = new Date()): boolean {
  const candidateYears = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];
  return candidateYears.some((y) => {
    const { start, end } = windowForYear(config, y);
    return now.getTime() >= start.getTime() && now.getTime() < end.getTime();
  });
}

// ----------------------------------------------------------------------------
// Själva listan - 16 säsongs-/högtidskollektioner, hämtade GID:n från butiken
// 2026-11-22 (se claude/citall-store-kollektioner-taggar.md för taggbakgrund).
// ----------------------------------------------------------------------------

export const SEASONS: SeasonConfig[] = [
  {
    key: "spring",
    menuTitle: "Vår",
    collectionId: "gid://shopify/Collection/529639833868",
    collectionHandle: "spring-collection",
    window: { kind: "fixed", startMonth: 3, startDay: 1, endMonth: 5, endDay: 31 },
    discount: null,
  },
  {
    key: "summer",
    menuTitle: "Sommar",
    collectionId: "gid://shopify/Collection/529639866636",
    collectionHandle: "summer-collection",
    window: { kind: "fixed", startMonth: 6, startDay: 1, endMonth: 8, endDay: 31 },
    discount: null,
  },
  {
    key: "autumn",
    menuTitle: "Höst",
    collectionId: "gid://shopify/Collection/529639899404",
    collectionHandle: "autumn-collection",
    window: { kind: "fixed", startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
    discount: null,
  },
  {
    key: "winter",
    menuTitle: "Vinter",
    collectionId: "gid://shopify/Collection/529639964940",
    collectionHandle: "winter-collection",
    window: { kind: "fixed", startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 },
    discount: null,
  },
  {
    key: "christmas",
    menuTitle: "Jul",
    collectionId: "gid://shopify/Collection/529639997708",
    collectionHandle: "christmas-collection",
    window: { kind: "fixed", startMonth: 12, startDay: 1, endMonth: 12, endDay: 24 },
    discount: { codeStem: "JUL10", percentage: 0.1, scope: "storewide" },
    // JUL10 (utan årtal) skapades för hand 2026-11-22, innan den här filen fanns.
    skipDiscountForStartYear: 2026,
  },
  {
    key: "halloween",
    menuTitle: "Halloween",
    collectionId: "gid://shopify/Collection/529640030476",
    collectionHandle: "halloween-collection",
    window: { kind: "fixed", startMonth: 10, startDay: 1, endMonth: 10, endDay: 31 },
    discount: { codeStem: "HALLOWEEN15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "valentines",
    menuTitle: "Alla hjärtans dag",
    collectionId: "gid://shopify/Collection/529640063244",
    collectionHandle: "valentines-day-collection",
    window: { kind: "fixed", startMonth: 2, startDay: 1, endMonth: 2, endDay: 14 },
    discount: { codeStem: "VALENTINES15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "blackfriday",
    menuTitle: "Black Friday",
    collectionId: "gid://shopify/Collection/529640161548",
    collectionHandle: "black-friday-collection",
    // Black Friday = fredagen efter 4:e torsdagen (Thanksgiving) i november,
    // till och med Cyber Monday (3 dagar senare) - rörligt, inte fast datum.
    window: {
      kind: "moving",
      anchor: (year) => addDays(nthWeekdayOfMonth(year, 11, 4, 4), 1), // dagen efter Thanksgiving
      daysBefore: 0,
      daysAfter: 3, // fre+lör+sön+mån (cyber monday)
    },
    discount: { codeStem: "BLACKFRIDAY20", percentage: 0.2, scope: "storewide" },
    // BLACKFRIDAY20 (utan årtal) skapades för hand 2026-11-06, innan den här filen fanns.
    skipDiscountForStartYear: 2026,
  },
  {
    key: "newyear",
    menuTitle: "Nyår",
    collectionId: "gid://shopify/Collection/529640128780",
    collectionHandle: "new-years-collection",
    window: { kind: "fixed", startMonth: 12, startDay: 26, endMonth: 1, endDay: 6 },
    discount: { codeStem: "NEWYEAR15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "easter",
    menuTitle: "Påsk",
    collectionId: "gid://shopify/Collection/529562435852",
    collectionHandle: "easter-collection",
    window: { kind: "moving", anchor: easterSunday, daysBefore: 21, daysAfter: 1 }, // t.o.m. annandag påsk
    discount: { codeStem: "EASTER15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "midsummer",
    menuTitle: "Midsommar",
    collectionId: "gid://shopify/Collection/529640096012",
    collectionHandle: "midsummer-collection",
    window: { kind: "moving", anchor: midsummerEve, daysBefore: 10, daysAfter: 1 }, // t.o.m. midsommardagen
    discount: { codeStem: "MIDSUMMER15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "mothersday",
    menuTitle: "Mors dag",
    collectionId: "gid://shopify/Collection/529640194316",
    collectionHandle: "mothers-day-collection",
    // Sista söndagen i maj.
    window: { kind: "moving", anchor: (year) => nthWeekdayOfMonth(year, 5, 0, -1), daysBefore: 14, daysAfter: 0 },
    discount: { codeStem: "MOTHERSDAY15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "fathersdayse",
    menuTitle: "Fars dag",
    collectionId: "gid://shopify/Collection/529640227084",
    collectionHandle: "fathers-day-collection",
    // Andra söndagen i november (Sverige).
    window: { kind: "moving", anchor: (year) => nthWeekdayOfMonth(year, 11, 0, 2), daysBefore: 14, daysAfter: 0 },
    discount: { codeStem: "FATHERSDAYSE15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "fathersdayus",
    menuTitle: "Father's Day (US)",
    collectionId: "gid://shopify/Collection/725792948492",
    collectionHandle: "fathers-day-usa",
    // Tredje söndagen i juni (USA).
    window: { kind: "moving", anchor: (year) => nthWeekdayOfMonth(year, 6, 0, 3), daysBefore: 14, daysAfter: 0 },
    discount: { codeStem: "FATHERSDAYUS15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "backtoschool",
    menuTitle: "Skolstart",
    collectionId: "gid://shopify/Collection/529640259852",
    collectionHandle: "back-to-school-collection",
    window: { kind: "fixed", startMonth: 8, startDay: 1, endMonth: 8, endDay: 31 },
    discount: { codeStem: "BACKTOSCHOOL15", percentage: 0.15, scope: "collection" },
  },
  {
    key: "thanksgiving",
    menuTitle: "Thanksgiving",
    collectionId: "gid://shopify/Collection/529640292620",
    collectionHandle: "thanksgiving-collection",
    // Fjärde torsdagen i november (USA).
    window: { kind: "moving", anchor: (year) => nthWeekdayOfMonth(year, 11, 4, 4), daysBefore: 10, daysAfter: 0 },
    discount: { codeStem: "THANKSGIVING15", percentage: 0.15, scope: "collection" },
  },
];
