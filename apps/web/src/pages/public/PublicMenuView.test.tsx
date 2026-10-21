import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  act,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicMenuView } from "./PublicMenuView";
import type { PublicMenuResponse } from "@paserve/contracts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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

it("lets keyboard users skip the header and filters to menu actions", async () => {
  render(<PublicMenuView menu={menu} />);
  const user = userEvent.setup();
  await user.tab();
  const skip = screen.getByRole("link", { name: "Skip to menu items" });
  expect(skip).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(document.getElementById(skip.getAttribute("href")!.slice(1))).toHaveFocus();
  await user.tab();
  expect(screen.getAllByRole("button", { name: "View details for Coffee" })[0]).toHaveFocus();
});
it("combines availability with search and recovers without losing cart access", async () => {
  const user = userEvent.setup();
  render(<PublicMenuView menu={{ ...menu, products: [coffee,
    { ...coffee, id: "sold", name: "Sold-out coffee", status: "SOLD_OUT", isOrderable: false },
    { ...coffee, id: "blocked", name: "Unavailable coffee", isOrderable: false }],
  }} />);
  const available = screen.getByRole("button", { name: "Available now" });
  await user.click(available);
  expect(available).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("heading", { name: "Sold-out coffee" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Unavailable coffee" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 item available now");
  const search = screen.getByRole("searchbox", { name: "Search menu" });
  await user.type(search, "missing");
  expect(screen.getByText("No available items match these filters.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Show all items" }));
  expect(available).toHaveAttribute("aria-pressed", "false");
  expect(search).toHaveFocus();
  expect(search).toHaveValue("");
  expect(screen.getByRole("heading", { name: "Sold-out coffee" })).toBeVisible();
  expect(screen.getByRole("button", { name: "View details for Sold-out coffee" })).toHaveAccessibleDescription("Sold out");
  expect(screen.getByRole("button", { name: "View cart (0)" })).toBeEnabled();
});

it("moves the category indicator and keyboard focus to the chosen section", async () => {
  const user = userEvent.setup();
  render(<PublicMenuView menu={menu} />);
  const nav = within(screen.getByRole("navigation", { name: "Menu categories" }));
  const first = nav.getByRole("link", { name: "Featured1" });
  const meals = nav.getByRole("link", { name: "Meals1" });
  expect(first).toHaveAttribute("aria-current", "location");
  await user.click(meals);
  expect(meals).toHaveAttribute("aria-current", "location");
  expect(first).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("heading", { name: "Meals" })).toHaveFocus();
  const search = screen.getByRole("searchbox");
  await user.type(search, "drinks");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(search).toHaveFocus();
});

it("updates the category indicator as sections enter view and releases its observer", () => {
  let notify: IntersectionObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  const view = render(<PublicMenuView menu={menu} />);
  const meals = screen.getByRole("region", { name: "Meals" });
  act(() => notify([{
    target: meals, isIntersecting: true, intersectionRatio: 1,
    boundingClientRect: meals.getBoundingClientRect(),
    intersectionRect: meals.getBoundingClientRect(), rootBounds: null, time: 0,
  }], {} as IntersectionObserver));
  const nav = within(screen.getByRole("navigation", { name: "Menu categories" }));
  expect(nav.getByRole("link", { name: "Meals1" })).toHaveAttribute("aria-current", "location");
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it("explains an unpublished menu and keeps preview guidance separate from customer actions", () => {
  render(<PublicMenuView menu={{ ...menu, products: [], featuredProducts: [] }} preview />);
  expect(screen.getByRole("heading", { name: "No items are available on this menu yet." })).toBeVisible();
  expect(screen.getByText("Add a visible product to start building this menu.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Refresh menu" })).not.toBeInTheDocument();
  expect(screen.queryByText("No matches. Try another craving.")).not.toBeInTheDocument();
});

it("makes menu text and actions usable before secondary images load", () => {
  const { container } = render(<PublicMenuView menu={{ ...menu, shop: { ...menu.shop, bannerUrl: "https://example.com/banner.webp", logoUrl: "https://example.com/logo.webp" } }} />);
  expect(screen.getByRole("heading", { name: "Cafe" })).toBeVisible();
  expect(screen.getByRole("searchbox")).toBeEnabled();
  for (const button of screen.getAllByRole("button", { name: "View details for Coffee" }))
    expect(button).toBeEnabled();
  for (const image of container.querySelectorAll(".shop-banner img, .shop-logo img, .menu-product-media img")) {
    expect(Number(image.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(image.getAttribute("height"))).toBeGreaterThan(0);
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveAttribute("fetchpriority", "low");
  }
  fireEvent.error(screen.getByRole("img", { name: "Cafe banner" }));
  expect(screen.getByRole("searchbox")).toBeEnabled();
  expect(screen.getByRole("heading", { name: "Cafe" })).toBeVisible();
});

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
