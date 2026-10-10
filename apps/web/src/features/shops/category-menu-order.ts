import type { MenuCategory, PublicMenuResponse } from "@paserve/contracts";

/** Reorder only categories already published in this menu; never introduce hidden data. */
export function withCategoryOrder(
  menu: PublicMenuResponse,
  order: Pick<MenuCategory, "id" | "sortOrder">[],
): PublicMenuResponse {
  const positions = new Map(
    order.map((category, index) => [
      category.id,
      { index, sortOrder: category.sortOrder },
    ]),
  );
  return {
    ...menu,
    categories: menu.categories
      .map((category) => ({
        ...category,
        sortOrder: positions.get(category.id)?.sortOrder ?? category.sortOrder,
      }))
      .sort(
        (a, b) =>
          (positions.get(a.id)?.index ?? order.length) -
          (positions.get(b.id)?.index ?? order.length),
      ),
  };
}
