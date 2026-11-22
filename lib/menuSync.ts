import { adminGraphQL } from "./shopify";
import { SEASONS, isSeasonActive, type SeasonConfig } from "./seasons";

// ============================================================================
// Meny-synk — håller huvudmenyn ("main-menu") i synk med vilka säsongs-/
// högtidskollektioner som är aktuella just nu. Lägger in en ny rad direkt i
// huvudmenyn (näst efter "Home") när en säsong börjar, tar bort precis den
// raden när den tar slut - rör ALDRIG någon annan rad i menyn.
//
// Shopifys `menuUpdate`-mutation ersätter HELA menyns `items`-lista i ett
// enda anrop (det finns ingen "lägg till en rad"/"ta bort en rad"-mutation),
// så varje körning: hämtar hela den nuvarande listan, bygger en ny lista med
// exakt de säsongsrader som ska finnas just nu, och skickar tillbaka HELA
// listan - övriga rader skickas med precis som de redan var (samma `id`,
// så Shopify vet att det är samma rader, inte nya).
//
// Tillägg 2026-11-22, på Christoffers begäran: en säsong som är inom sitt
// datumfönster men vars kollektion fortfarande har 0 produkter (produkt-
// taggningen pågår löpande, se claude/citall-store-kollektioner-taggar.md)
// ska INTE synas i menyn än - ingen anledning att länka kunder till en tom
// sida. Så fort kollektionen får sin första produkt tas den upp automatiskt
// vid nästa körning, utan att någon behöver göra något manuellt.
// ============================================================================

const MENU_HANDLE = "main-menu";

type RawMenuItem = {
  id: string;
  title: string;
  type: string;
  resourceId: string | null;
  url: string | null;
  items: RawMenuItem[];
};

type MenuItemUpdateInput = {
  id?: string;
  title: string;
  type: string;
  resourceId?: string;
  url?: string;
  items?: MenuItemUpdateInput[];
};

const MENU_QUERY = `
  query MainMenu {
    menus(first: 20) {
      nodes {
        id
        handle
        title
        items {
          id
          title
          type
          resourceId
          url
          items {
            id
            title
            type
            resourceId
            url
            items { id title type resourceId url }
          }
        }
      }
    }
  }
`;

const MENU_UPDATE_MUTATION = `
  mutation UpdateMenu($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu { id }
      userErrors { field message }
    }
  }
`;

const HAS_PRODUCT_QUERY = `
  query HasProduct($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Collection { id hasProduct }
    }
  }
`;

/** Vilka av de här kollektions-GID:na har minst en produkt i sig just nu. */
async function collectionsWithProducts(collectionIds: string[]): Promise<Set<string>> {
  if (collectionIds.length === 0) return new Set();
  const data = await adminGraphQL<{ nodes: Array<{ id: string; hasProduct: boolean } | null> }>(
    HAS_PRODUCT_QUERY,
    { ids: collectionIds }
  );
  return new Set(data.nodes.filter((n) => n?.hasProduct).map((n) => (n as { id: string }).id));
}

function toUpdateInput(item: RawMenuItem): MenuItemUpdateInput {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    resourceId: item.resourceId ?? undefined,
    // Skickas med oförändrad för alla BEFINTLIGA rader (viktigt för typer som
    // FRONTPAGE/HTTP som inte har ett resourceId att räkna om url ifrån).
    url: item.url ?? undefined,
    items: item.items.length > 0 ? item.items.map(toUpdateInput) : undefined,
  };
}

function seasonMenuItem(season: SeasonConfig): MenuItemUpdateInput {
  return {
    title: season.menuTitle,
    type: "COLLECTION",
    resourceId: season.collectionId,
  };
}

const SEASON_COLLECTION_IDS = new Set(SEASONS.map((s) => s.collectionId));

export type MenuSyncResult =
  | { changed: false }
  | { changed: true; added: string[]; removed: string[] };

export async function syncSeasonalMenu(now: Date = new Date()): Promise<MenuSyncResult> {
  const data = await adminGraphQL<{
    menus: { nodes: Array<{ id: string; handle: string; title: string; items: RawMenuItem[] }> };
  }>(MENU_QUERY);

  const menu = data.menus.nodes.find((m) => m.handle === MENU_HANDLE);
  if (!menu) {
    throw new Error(`Hittade ingen meny med handle "${MENU_HANDLE}".`);
  }

  const currentTopLevel = menu.items;
  const currentSeasonKeysPresent = new Set(
    currentTopLevel
      .filter((item) => item.resourceId && SEASON_COLLECTION_IDS.has(item.resourceId))
      .map((item) => item.resourceId as string)
  );

  const dueByDate = SEASONS.filter((s) => isSeasonActive(s, now));
  const withProducts = await collectionsWithProducts(dueByDate.map((s) => s.collectionId));
  const activeSeasons = dueByDate.filter((s) => withProducts.has(s.collectionId));
  const activeSeasonIds = new Set(activeSeasons.map((s) => s.collectionId));

  const sameSet =
    currentSeasonKeysPresent.size === activeSeasonIds.size &&
    [...activeSeasonIds].every((id) => currentSeasonKeysPresent.has(id));
  if (sameSet) {
    return { changed: false };
  }

  // Behåll alla rader som INTE är säsongsrader, i samma ordning. Lägg sen de
  // aktiva säsongsraderna direkt efter första raden (vanligtvis "Home").
  const nonSeasonItems = currentTopLevel.filter(
    (item) => !(item.resourceId && SEASON_COLLECTION_IDS.has(item.resourceId))
  );
  const [firstItem, ...restItems] = nonSeasonItems;
  const newItems: MenuItemUpdateInput[] = [
    ...(firstItem ? [toUpdateInput(firstItem)] : []),
    ...activeSeasons.map(seasonMenuItem),
    ...restItems.map(toUpdateInput),
  ];

  const added = [...activeSeasonIds].filter((id) => !currentSeasonKeysPresent.has(id));
  const removed = [...currentSeasonKeysPresent].filter((id) => !activeSeasonIds.has(id));

  const result = await adminGraphQL<{
    menuUpdate: { menu: { id: string } | null; userErrors: Array<{ field: string[]; message: string }> };
  }>(MENU_UPDATE_MUTATION, { id: menu.id, title: menu.title, items: newItems });

  if (result.menuUpdate.userErrors.length > 0) {
    throw new Error(
      `menuUpdate gav fel: ${result.menuUpdate.userErrors.map((e) => e.message).join("; ")}`
    );
  }

  const idToTitle = new Map(SEASONS.map((s) => [s.collectionId, s.menuTitle]));
  return {
    changed: true,
    added: added.map((id) => idToTitle.get(id) ?? id),
    removed: removed.map((id) => idToTitle.get(id) ?? id),
  };
}
