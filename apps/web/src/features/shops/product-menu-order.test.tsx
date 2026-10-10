import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PublicMenuResponse } from "@paserve/contracts";
import { withProductOrder } from "./product-menu-order";
import { PublicMenuView } from "../../pages/public/PublicMenuView";

afterEach(cleanup);
const item = (
  id: string,
  categoryId: string | null,
  sortOrder: number,
): PublicMenuResponse["products"][number] => ({
  id,
  categoryId,
  sortOrder,
  name: id,
  slug: id,
  price: "12.50",
  description: "Fresh",
  imageUrl: null,
  status: "SOLD_OUT",
  isOrderable: false,
  isFeatured: true,
});
const first = item("First", "coffee", 0);
const second = item("Second", "coffee", 1);
const other = item("Other", "meals", 0);
const menu: PublicMenuResponse = {
  shop: { name: "Cafe", slug: "cafe", description: null },
  categories: [
    {
      id: "coffee",
      name: "Coffee",
      slug: "coffee",
      description: null,
      sortOrder: 0,
    },
    {
      id: "meals",
      name: "Meals",
      slug: "meals",
      description: null,
      sortOrder: 1,
    },
  ],
  products: [first, other, second],
  featuredProducts: [first, other, second],
};
const saved = [
  { id: "Hidden", categoryId: "coffee", sortOrder: 0 },
  { ...second, sortOrder: 1 },
  { ...first, sortOrder: 2 },
];

it("updates only published category items and preserves independent featured order", () => {
  const result = withProductOrder(menu, "coffee", saved);
  expect(result.products).toEqual([second, other, { ...first, sortOrder: 2 }]);
  expect(result.featuredProducts).toBe(menu.featuredProducts);
  expect(result.products[1]).toBe(other);
  expect(result.categories).toBe(menu.categories);
  expect(result.shop).toBe(menu.shop);
  expect(menu.products).toEqual([first, other, second]);
  const subset = withProductOrder(
    { ...menu, featuredProducts: [first] },
    "coffee",
    saved,
  );
  expect(subset.featuredProducts).toEqual([first]);
});

it("reorders Uncategorized independently and ignores records from other categories", () => {
  const a = item("A", null, 0);
  const b = item("B", null, 1);
  const result = withProductOrder(
    { ...menu, products: [a, other, b], featuredProducts: [] },
    null,
    [
      { ...b, sortOrder: 0 },
      { ...a, sortOrder: 1 },
      { ...other, sortOrder: 9 },
    ],
  );
  expect(result.products).toEqual([
    { ...b, sortOrder: 0 },
    other,
    { ...a, sortOrder: 1 },
  ]);
  expect(result.featuredProducts).toEqual([]);
});

it.each(["grid", "list", "compact"] as const)(
  "renders saved per-category order in the %s customer layout",
  (menuLayout) => {
    render(
      <PublicMenuView
        menu={withProductOrder(
          { ...menu, shop: { ...menu.shop, menuLayout } },
          "coffee",
          saved,
        )}
      />,
    );
    const names = (region: string) =>
      within(screen.getByRole("region", { name: region }))
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);
    expect(names("Coffee")).toEqual(["Second", "First"]);
    expect(names("Meals")).toEqual(["Other"]);
    expect(names("Featured")).toEqual(["First", "Other", "Second"]);
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  },
);
