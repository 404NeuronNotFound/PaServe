import type { MenuProduct, PublicMenuResponse } from "@paserve/contracts";

export function withFeaturedOrder(
  menu: PublicMenuResponse,
  saved: MenuProduct[],
): PublicMenuResponse {
  const ranks = new Map(saved.map((item, index) => [item.id, index]));
  const update = (item: PublicMenuResponse["products"][number]) =>
    ranks.has(item.id)
      ? { ...item, featuredSortOrder: ranks.get(item.id)! }
      : item;
  return {
    ...menu,
    products: menu.products.map(update),
    featuredProducts: menu.featuredProducts
      .map(update)
      .sort(
        (a, b) =>
          (ranks.get(a.id) ?? saved.length) - (ranks.get(b.id) ?? saved.length),
      ),
  };
}

export function withFeaturedSelection(
  menu: PublicMenuResponse,
  saved: MenuProduct,
): PublicMenuResponse {
  // Only an already-public item can be selected here; server refetch supplies new eligible items.
  const products = menu.products.map((item) =>
    item.id === saved.id
      ? {
          ...item,
          isFeatured: saved.isFeatured,
          featuredSortOrder: saved.featuredSortOrder,
        }
      : item,
  );
  return {
    ...menu,
    products,
    featuredProducts: products
      .filter((item) => item.isFeatured)
      .sort(
        (a, b) =>
          (a.featuredSortOrder ?? a.sortOrder) -
            (b.featuredSortOrder ?? b.sortOrder) || a.id.localeCompare(b.id),
      ),
  };
}
