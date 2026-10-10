import type { MenuProduct, PublicMenuResponse } from "@paserve/contracts";

/** Reorder published items in one category without introducing private products. */
export function withProductOrder(
  menu: PublicMenuResponse,
  categoryId: string | null,
  saved: Pick<MenuProduct, "id" | "categoryId" | "sortOrder">[],
): PublicMenuResponse {
  const positions = new Map(
    saved.filter((item) => item.categoryId === categoryId).map((item, index) => [
      item.id,
      { index, sortOrder: item.sortOrder },
    ]),
  );
  const reorder = (items: PublicMenuResponse["products"]) => {
    const group = items
      .filter((item) => item.categoryId === categoryId)
      .map((item) => ({
        ...item,
        sortOrder: positions.get(item.id)?.sortOrder ?? item.sortOrder,
      }))
      .sort((a, b) =>
        (positions.get(a.id)?.index ?? saved.length) -
        (positions.get(b.id)?.index ?? saved.length),
      );
    let index = 0;
    return items.map((item) => item.categoryId === categoryId ? group[index++] : item);
  };
  return {
    ...menu,
    products: reorder(menu.products),
    featuredProducts: menu.featuredProducts,
  };
}
