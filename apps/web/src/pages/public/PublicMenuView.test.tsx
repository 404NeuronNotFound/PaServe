import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicMenuView } from "./PublicMenuView";
import type { PublicMenuResponse } from "@paserve/contracts";

afterEach(cleanup);
const coffee: PublicMenuResponse["products"][number] = {
  id: "coffee",
  categoryId: "drinks",
  name: "Coffee",
  slug: "coffee",
  description: "Our dark roast",
  price: "120.01",
  imageUrl: "https://example.com/coffee.webp",
  status: "AVAILABLE",
  isOrderable: true,
  isFeatured: true,
  sortOrder: 0,
};
const menu: PublicMenuResponse = {
  shop: { name: "Cafe", slug: "cafe", description: "Made for good mornings." },
  categories: [
    {
      id: "drinks",
      name: "Drinks",
      slug: "drinks",
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
    {
      id: "empty",
      name: "Empty",
      slug: "empty",
      description: null,
      sortOrder: 2,
    },
  ],
  products: [
    coffee,
    {
      ...coffee,
      id: "rice",
      categoryId: "meals",
      name: "Rice bowl",
      description: "Warm and savory",
      imageUrl: null,
      isFeatured: false,
    },
  ],
  featuredProducts: [coffee],
};

it.each(["grid", "list", "compact"] as const)(
  "supports category destinations, searching and recovery in %s",
  async (menuLayout) => {
    const user = userEvent.setup();
    render(
      <PublicMenuView menu={{ ...menu, shop: { ...menu.shop, menuLayout } }} />,
    );
    const nav = screen.getByRole("navigation", { name: "Menu categories" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Featured1",
      "Drinks1",
      "Meals1",
    ]);
    for (const link of links) {
      const heading = document.getElementById(
        link.getAttribute("href")!.slice(1),
      );
      expect(heading?.tagName).toBe("H2");
      expect(heading).toHaveAttribute("tabindex", "-1");
    }
    const search = screen.getByRole("searchbox", { name: "Search menu" });
    await user.type(search, "savory");
    expect(
      screen.getByRole("heading", { name: "Rice bowl" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Coffee" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 item matching");
    await user.clear(search);
    await user.type(search, "DRINKS");
    expect(screen.getAllByRole("heading", { name: "Coffee" })).toHaveLength(2);
    expect(
      screen.queryByRole("heading", { name: "Rice bowl" }),
    ).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "missing");
    expect(
      screen.getByText("No matches. Try another craving."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Menu categories" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", { name: "Clear search" })[0],
    );
    expect(
      screen.getByRole("heading", { name: "Rice bowl" }),
    ).toBeInTheDocument();
    expect(search).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "View cart (0)" }),
    ).toBeInTheDocument();
  },
);

it("replaces broken product images without losing the product action", () => {
  render(<PublicMenuView menu={{ ...menu, featuredProducts: [] }} />);
  const section = screen.getByRole("region", { name: "Drinks" });
  fireEvent.error(section.querySelector("img")!);
  expect(section.querySelector("img")).not.toBeInTheDocument();
  expect(
    within(section).getByRole("heading", { name: "Coffee" }),
  ).toBeInTheDocument();
  expect(
    within(section).getByRole("button", { name: "View details for Coffee" }),
  ).toBeEnabled();
});

it("keeps section destinations unique between the customer menu and owner preview", () => {
  render(
    <>
      <PublicMenuView menu={menu} />
      <PublicMenuView menu={menu} preview />
    </>,
  );
  const navs = screen.getAllByRole("navigation", { name: "Menu categories" });
  const destinations = navs.flatMap((nav) =>
    within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")),
  );
  expect(new Set(destinations).size).toBe(destinations.length);
  expect(screen.getAllByRole("button", { name: "View cart (0)" })).toHaveLength(
    1,
  );
});
it("keeps the cart accessible when the public menu becomes empty", () => {
  render(
    <PublicMenuView menu={{ ...menu, products: [], featuredProducts: [] }} />,
  );
  expect(
    screen.getByRole("button", { name: "View cart (0)" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
it("renders the public cart for a valid constructor shop slug", () => {
  render(
    <PublicMenuView
      menu={{ ...menu, shop: { ...menu.shop, slug: "constructor" } }}
    />,
  );
  expect(
    screen.getByRole("button", { name: "View cart (0)" }),
  ).toBeInTheDocument();
});
