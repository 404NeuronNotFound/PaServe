import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { MenuProduct, PublicMenuResponse } from "@paserve/contracts";
import { withFeaturedOrder, withFeaturedSelection } from "./featured-menu";
import { PublicMenuView } from "../../pages/public/PublicMenuView";
afterEach(cleanup);
const product: MenuProduct = {
  id: "a",
  shopId: "shop",
  categoryId: "coffee",
  name: "Coffee",
  slug: "coffee",
  description: null,
  price: "12.50",
  imageUrl: null,
  status: "AVAILABLE",
  isFeatured: true,
  isArchived: false,
  sortOrder: 0,
  featuredSortOrder: 0,
  createdAt: "2026-10-10T00:00:00Z",
};
const second = {
  ...product,
  id: "b",
  name: "Tea",
  slug: "tea",
  categoryId: null,
  featuredSortOrder: 1,
};
const menu: PublicMenuResponse = {
  shop: { name: "Cafe", slug: "cafe", description: null },
  categories: [
    {
      id: "coffee",
      name: "Drinks",
      slug: "drinks",
      description: null,
      sortOrder: 0,
    },
  ],
  products: [
    { ...product, status: "AVAILABLE", isOrderable: true },
    { ...second, status: "SOLD_OUT", isOrderable: false },
  ],
  featuredProducts: [],
};
menu.featuredProducts = [...menu.products];
it("changes featured rank across categories without changing normal order or publishing private items", () => {
  const hidden = { ...product, id: "hidden", status: "HIDDEN" as const };
  const changed = withFeaturedOrder(menu, [second, hidden, product]);
  expect(changed.products.map((item) => [item.id, item.sortOrder])).toEqual([
    ["a", 0],
    ["b", 0],
  ]);
  expect(
    changed.featuredProducts.map((item) => [item.id, item.featuredSortOrder]),
  ).toEqual([
    ["b", 0],
    ["a", 2],
  ]);
  expect(changed.featuredProducts[0].isOrderable).toBe(false);
  expect(menu.featuredProducts[0].id).toBe("a");
});
it("selects and removes only already-public items", () => {
  const removed = withFeaturedSelection(menu, {
    ...product,
    isFeatured: false,
  });
  expect(removed.featuredProducts.map((item) => item.id)).toEqual(["b"]);
  expect(removed.products).toHaveLength(2);
  expect(
    withFeaturedSelection(removed, product).featuredProducts.map(
      (item) => item.id,
    ),
  ).toEqual(["a", "b"]);
  expect(
    withFeaturedSelection(menu, {
      ...product,
      id: "private",
      status: "HIDDEN",
    }),
  ).toEqual(menu);
});
it.each(["grid", "list", "compact"] as const)(
  "renders highlights independently in the %s layout",
  (menuLayout) => {
    render(
      <PublicMenuView
        menu={withFeaturedOrder(
          { ...menu, shop: { ...menu.shop, menuLayout } },
          [second, product],
        )}
      />,
    );
    const names = (name: string) =>
      within(screen.getByRole("region", { name }))
        .getAllByRole("heading", { level: 3 })
        .map((item) => item.textContent);
    expect(names("Featured")).toEqual(["Tea", "Coffee"]);
    expect(names("Drinks")).toEqual(["Coffee"]);
    expect(names("Uncategorized")).toEqual(["Tea"]);
    expect(
      within(screen.getByRole("region", { name: "Featured" })).getByText(
        "Sold out",
      ),
    ).toBeInTheDocument();
  },
);
