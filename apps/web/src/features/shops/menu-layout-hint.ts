import {
  DEFAULT_MENU_LAYOUT,
  isMenuLayout,
  type MenuLayout,
  type PublicMenuResponse,
} from "@paserve/contracts";

const KEY = "paserve.public-menu-layout.v1";
const MAX_AGE = 30 * 60 * 1000;
type LayoutHint = {
  layout: MenuLayout;
  banner: boolean;
  count: number;
  savedAt: number;
};

/** Public presentation hints only. Never a source of products, prices or table access. */
export function readMenuLayoutHint(slug: string): LayoutHint | undefined {
  try {
    const entries: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(entries)) return;
    const entry = entries.find((value) => value?.slug === slug);
    if (
      entry &&
      isMenuLayout(entry.layout) &&
      typeof entry.banner === "boolean" &&
      Number.isInteger(entry.count) &&
      entry.count >= 0 &&
      entry.count <= 6 &&
      typeof entry.savedAt === "number" &&
      entry.savedAt <= Date.now() &&
      Date.now() - entry.savedAt < MAX_AGE
    )
      return {
        layout: entry.layout,
        banner: entry.banner,
        count: entry.count,
        savedAt: entry.savedAt,
      };
  } catch {
    /* Storage is optional; cold loads use a layout-neutral skeleton. */
  }
}

export function rememberMenuLayoutHint(menu: PublicMenuResponse) {
  const first =
    menu.featuredProducts.length ||
    menu.categories
      .map(
        (category) =>
          menu.products.filter((product) => product.categoryId === category.id)
            .length,
      )
      .find(Boolean) ||
    menu.products.filter((product) => product.categoryId === null).length;
  const entry = {
    slug: menu.shop.slug,
    layout: isMenuLayout(menu.shop.menuLayout)
      ? menu.shop.menuLayout
      : DEFAULT_MENU_LAYOUT,
    banner: Boolean(menu.shop.bannerUrl),
    count: Math.min(first, 6),
    savedAt: Date.now(),
  };
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    const entries = Array.isArray(parsed)
      ? parsed.filter(
          (value) =>
            value?.slug !== entry.slug && Date.now() - value?.savedAt < MAX_AGE,
        )
      : [];
    sessionStorage.setItem(KEY, JSON.stringify([...entries.slice(-19), entry]));
  } catch {
    /* The menu remains usable when storage is blocked or full. */
  }
}
