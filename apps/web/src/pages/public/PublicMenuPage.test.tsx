import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PublicMenuPage } from "./PublicMenuPage";
import { api } from "../../lib/api/client";

vi.mock("../../lib/api/client", () => ({ api: { get: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function setup() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/cafe"]}>
        <Routes>
          <Route path="/:shopSlug" element={<PublicMenuPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
const menu = {
  shop: {
    name: "Cafe",
    slug: "cafe",
    description: null,
    logoUrl: "https://example.com/logo.webp",
  },
  categories: [],
  products: [],
  featuredProducts: [],
};

it.each(["grid", "list", "compact"])(
  "renders category descriptions in configured order and reflects visibility/order refreshes in %s",
  async (menuLayout) => {
    const category = (id: string, name: string, sortOrder: number) => ({
      id, name, slug: id, description: `${name} description`, sortOrder,
    });
    const product = (id: string, categoryId: string | null) => ({
      id, categoryId, name: id, slug: id, price: "20.00", description: null,
      imageUrl: null, status: "AVAILABLE", isOrderable: true,
      isFeatured: false, sortOrder: 0,
    });
    const desserts = category("desserts", "Zesty desserts", 0);
    const drinks = category("drinks", "Artisan drinks", 1);
    const empty = category("empty", "Empty category", 2);
    const pastry = product("Pastry", "desserts");
    const coffee = product("Coffee", "drinks");
    const miscellaneous = product("Miscellaneous", null);
    const data = { ...menu, shop: { ...menu.shop, menuLayout },
      categories: [desserts, drinks, empty],
      products: [coffee, miscellaneous, pastry],
    };
    vi.mocked(api.get).mockResolvedValue({ data });
    const client = setup();
    await screen.findByRole("heading", { name: "Cafe" });
    const headings = () => screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings()).toEqual(["Zesty desserts", "Artisan drinks", "Uncategorized"]);
    expect(screen.getByText("Zesty desserts description")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Empty category" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Zesty desserts" })).getByRole("heading", { name: "Pastry" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Artisan drinks" })).getByRole("heading", { name: "Coffee" })).toBeInTheDocument();

    // The public API omits hidden categories and their products.
    vi.mocked(api.get).mockResolvedValue({ data: { ...data,
      categories: [drinks, empty], products: [coffee, miscellaneous],
    } });
    await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
    await vi.waitFor(() => expect(headings()).toEqual(["Artisan drinks", "Uncategorized"]));
    expect(screen.queryByText("Zesty desserts description")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pastry" })).not.toBeInTheDocument();

    // Showing it again with a new configured order restores the correct section.
    vi.mocked(api.get).mockResolvedValue({ data: { ...data,
      categories: [{ ...drinks, sortOrder: 0 }, { ...desserts, sortOrder: 1 }, empty],
    } });
    await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
    await vi.waitFor(() => expect(headings()).toEqual(["Artisan drinks", "Zesty desserts", "Uncategorized"]));
    expect(screen.getByRole("heading", { name: "Pastry" })).toBeInTheDocument();
  },
);

it("keeps a menu without visible categories usable", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: menu });
  setup();
  await screen.findByRole("heading", { name: "Cafe" });
  expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  expect(screen.getByText("No items are available on this menu yet.")).toBeInTheDocument();
});

it.each(["grid", "list", "compact"])(
  "removes excluded products from categories and Featured after a public refetch in %s",
  async (menuLayout) => {
    const make = (id: string, categoryId: string | null, isFeatured = false) => ({
      id, name: id, slug: id, categoryId, description: `${id} description`,
      price: "1234.50", imageUrl: null, status: "AVAILABLE",
      isOrderable: true, isFeatured, sortOrder: 0,
    });
    const retained = make("Retained drink", "drinks");
    const hidden = make("Now hidden", "drinks", true);
    const archived = make("Now archived", "drinks", true);
    const deleted = make("Now deleted", "drinks", true);
    const uncategorized = make("Uncategorized item", null);
    const data = { ...menu, shop: { ...menu.shop, menuLayout },
      categories: [{ id: "drinks", name: "Drinks", slug: "drinks", description: null, sortOrder: 0 }],
      products: [retained, hidden, archived, deleted, uncategorized],
      featuredProducts: [hidden, archived, deleted],
    };
    vi.mocked(api.get).mockResolvedValue({ data });
    const client = setup();
    await screen.findByRole("heading", { name: "Retained drink" });
    expect(screen.getByRole("region", { name: "Featured" })).toBeInTheDocument();
    // Fresh public API responses omit hidden, archived, and physically deleted records.
    vi.mocked(api.get).mockResolvedValue({ data: {
      ...data, products: [retained, uncategorized], featuredProducts: [],
    } });
    await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
    await vi.waitFor(() => expect(screen.queryByRole("region", { name: "Featured" })).not.toBeInTheDocument());
    for (const name of ["Now hidden", "Now archived", "Now deleted"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
      expect(screen.queryByText(`${name} description`)).not.toBeInTheDocument();
    }
    expect(within(screen.getByRole("region", { name: "Drinks" })).getByRole("heading", { name: "Retained drink" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Uncategorized" })).getByRole("heading", { name: "Uncategorized item" })).toBeInTheDocument();
    expect(screen.getAllByText(/1,234\.50/)).toHaveLength(2);
  },
);

it.each(["grid", "list", "compact"])(
  "applies the complete API branding in %s layout and replaces it on refresh",
  async (menuLayout) => {
    const branded = {
      ...menu,
      shop: {
        ...menu.shop,
        description: "Coffee by the sea",
        bannerUrl: "https://example.com/banner.webp",
        primaryColor: "#FFFFFF",
        accentColor: "#000000",
        menuLayout,
      },
    };
    vi.mocked(api.get).mockResolvedValue({ data: branded });
    const client = setup();
    await screen.findByRole("heading", { name: "Cafe" });
    expect(screen.getByRole("img", { name: "Cafe logo" })).toHaveAttribute("src", branded.shop.logoUrl);
    expect(screen.getByRole("img", { name: "Cafe banner" })).toHaveAttribute("src", branded.shop.bannerUrl);
    expect(screen.getByText("Coffee by the sea")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("data-layout", menuLayout);
    const theme = () => screen.getByRole("main").style;
    expect(theme().getPropertyValue("--menu-primary")).toBe("#FFFFFF");
    expect(theme().getPropertyValue("--menu-on-primary")).toBe("#000000");
    expect(theme().getPropertyValue("--menu-accent")).toBe("#000000");
    expect(theme().getPropertyValue("--menu-on-accent")).toBe("#FFFFFF");

    const updated = {
      ...branded,
      shop: {
        ...branded.shop,
        logoUrl: "https://example.com/new-logo.webp",
        bannerUrl: "https://example.com/new-banner.webp",
        primaryColor: "#123456",
        accentColor: "#ABCDEF",
        menuLayout: menuLayout === "grid" ? "compact" : "grid",
      },
    };
    // A new saved image must remain usable after the previous image failed.
    fireEvent.error(screen.getByRole("img", { name: "Cafe logo" }));
    fireEvent.error(screen.getByRole("img", { name: "Cafe banner" }));
    vi.mocked(api.get).mockResolvedValue({ data: updated });
    await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
    await vi.waitFor(() => expect(screen.getByRole("img", { name: "Cafe logo" })).toHaveAttribute("src", updated.shop.logoUrl));
    expect(screen.getByRole("img", { name: "Cafe banner" })).toHaveAttribute("src", updated.shop.bannerUrl);
    expect(screen.getByRole("main")).toHaveAttribute("data-layout", updated.shop.menuLayout);
    expect(theme().getPropertyValue("--menu-primary")).toBe("#123456");
    expect(theme().getPropertyValue("--menu-accent")).toBe("#ABCDEF");
    expect(document.documentElement.style.getPropertyValue("--menu-primary")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--menu-accent")).toBe("");

    vi.mocked(api.get).mockResolvedValue({ data: { ...menu, shop: {
      ...menu.shop, logoUrl: null, bannerUrl: null, primaryColor: "invalid",
      accentColor: "url(unsafe)", menuLayout: "unsupported",
    } } });
    await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
    await vi.waitFor(() => expect(screen.queryByRole("img", { name: "Cafe logo" })).not.toBeInTheDocument());
    expect(screen.queryByRole("img", { name: "Cafe banner" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cafe" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("data-layout", "list");
    expect(theme().getPropertyValue("--menu-primary")).toBe("#243329");
    expect(theme().getPropertyValue("--menu-accent")).toBe("#C9EF83");
  },
);
it("changes layout without recreating menu items or changing their content and order", async () => {
  const products = [
    {
      id: "tea",
      categoryId: "drinks",
      name: "Tea",
      description: "Fresh tea",
      price: "15.00",
      status: "SOLD_OUT",
      imageUrl: null,
    },
    {
      id: "coffee",
      categoryId: "drinks",
      name: "Coffee",
      description: null,
      price: "20.00",
      status: "AVAILABLE",
      imageUrl: null,
    },
  ];
  const data = (menuLayout: string | undefined) => ({
    ...menu,
    shop: { ...menu.shop, menuLayout },
    categories: [{ id: "drinks", name: "Drinks" }],
    products,
  });
  vi.mocked(api.get).mockResolvedValue({ data: data(undefined) });
  const client = setup();
  const tea = await screen.findByRole("heading", { name: "Tea" });
  expect(screen.getByRole("main")).toHaveAttribute("data-layout", "list");
  for (const layout of ["grid", "compact", "list", "unsupported"]) {
    vi.mocked(api.get).mockResolvedValue({ data: data(layout) });
    await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
    await vi.waitFor(() =>
      expect(screen.getByRole("main")).toHaveAttribute(
        "data-layout",
        layout === "unsupported" ? "list" : layout,
      ),
    );
    expect(screen.getByRole("heading", { name: "Tea" })).toBe(tea);
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((item) => item.textContent),
    ).toEqual(["Tea", "Coffee"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Fresh tea")).toBeInTheDocument();
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    expect(screen.getByText(/15\.00/)).toBeInTheDocument();
    expect(screen.getByText(/20\.00/)).toBeInTheDocument();
  }
});
it("scopes the persisted brand color to the customer menu", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { ...menu, shop: { ...menu.shop, primaryColor: "#AABBCC" } },
  });
  setup();
  await screen.findByRole("heading", { name: "Cafe" });
  expect(
    screen.getByRole("main").style.getPropertyValue("--menu-primary"),
  ).toBe("#AABBCC");
  expect(
    document.documentElement.style.getPropertyValue("--menu-primary"),
  ).toBe("");
});
it("refreshes accent and its readable foreground independently and restores the default", async () => {
  const data = (accentColor: string | null) => ({
    ...menu,
    shop: { ...menu.shop, primaryColor: "#123456", accentColor },
  });
  vi.mocked(api.get).mockResolvedValue({ data: data("#000000") });
  const client = setup();
  await screen.findByRole("heading", { name: "Cafe" });
  const theme = () => screen.getByRole("main").style;
  expect(theme().getPropertyValue("--menu-accent")).toBe("#000000");
  expect(theme().getPropertyValue("--menu-on-accent")).toBe("#FFFFFF");
  vi.mocked(api.get).mockResolvedValue({ data: data("#FFFFFF") });
  await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
  await vi.waitFor(() =>
    expect(theme().getPropertyValue("--menu-accent")).toBe("#FFFFFF"),
  );
  expect(theme().getPropertyValue("--menu-on-accent")).toBe("#000000");
  expect(theme().getPropertyValue("--menu-primary")).toBe("#123456");
  expect(document.documentElement.style.getPropertyValue("--menu-accent")).toBe(
    "",
  );
  vi.mocked(api.get).mockResolvedValue({ data: data(null) });
  await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
  await vi.waitFor(() =>
    expect(theme().getPropertyValue("--menu-accent")).toBe("#C9EF83"),
  );
});
it("updates both theme colors after a saved-color refetch and resets to the default", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { ...menu, shop: { ...menu.shop, primaryColor: "#000000" } },
  });
  const client = setup();
  await screen.findByRole("heading", { name: "Cafe" });
  const theme = () => screen.getByRole("main").style;
  expect(theme().getPropertyValue("--menu-on-primary")).toBe("#FFFFFF");
  vi.mocked(api.get).mockResolvedValue({
    data: { ...menu, shop: { ...menu.shop, primaryColor: "#FFFFFF" } },
  });
  await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
  await vi.waitFor(() =>
    expect(theme().getPropertyValue("--menu-primary")).toBe("#FFFFFF"),
  );
  expect(theme().getPropertyValue("--menu-on-primary")).toBe("#000000");
  vi.mocked(api.get).mockResolvedValue({ data: menu });
  await client.invalidateQueries({ queryKey: ["public-menu", "cafe"] });
  await vi.waitFor(() =>
    expect(theme().getPropertyValue("--menu-primary")).toBe("#243329"),
  );
  expect(theme().getPropertyValue("--menu-on-primary")).toBe("#FFFFFF");
});
it("displays the persisted shop logo on a public route", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: menu });
  setup();
  expect(await screen.findByRole("img", { name: "Cafe logo" })).toHaveAttribute(
    "src",
    menu.shop.logoUrl,
  );
  expect(screen.getByRole("heading", { name: "Cafe" })).toBeInTheDocument();
  expect(screen.getByText(/No items are available/)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/menu/cafe", {
    signal: expect.any(AbortSignal),
  });
});
it("falls back to shop identity when a logo is missing or fails to load", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: menu });
  setup();
  fireEvent.error(await screen.findByRole("img", { name: "Cafe logo" }));
  expect(
    screen.queryByRole("img", { name: "Cafe logo" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cafe" })).toBeInTheDocument();
});
it("renders saved category and product order with sold-out labels", async () => {
  const product = {
    id: "a",
    name: "Coffee",
    categoryId: "drinks",
    price: "12.50",
    description: null,
    imageUrl: null,
    status: "SOLD_OUT",
  };
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...menu,
      categories: [{ id: "drinks", name: "Drinks" }],
      products: [
        product,
        { ...product, id: "b", name: "Tea", status: "AVAILABLE" },
      ],
    },
  });
  setup();
  await screen.findByRole("heading", { name: "Drinks" });
  expect(
    screen
      .getAllByRole("heading", { level: 3 })
      .map((item) => item.textContent),
  ).toEqual(["Coffee", "Tea"]);
  expect(screen.getByText("Sold out")).toBeInTheDocument();
});
it.each(["grid", "list", "compact"])("loads configured product order for independent customer sessions in %s layout", async (menuLayout) => {
  const coffee = { id: "coffee", name: "Coffee", categoryId: "drinks", sortOrder: 0, price: "12.50", description: null, imageUrl: null, status: "AVAILABLE" };
  const tea = { ...coffee, id: "tea", name: "Tea", sortOrder: 1, status: "SOLD_OUT" };
  const meal = { ...coffee, id: "meal", name: "Meal", categoryId: "meals" };
  const data = (products: typeof coffee[]) => ({
    ...menu, shop: { ...menu.shop, menuLayout },
    categories: [{ id: "drinks", name: "Drinks" }, { id: "meals", name: "Meals" }], products,
  });
  vi.mocked(api.get).mockResolvedValue({ data: data([coffee, meal, tea]) });
  const firstClient = setup();
  await screen.findByRole("heading", { name: "Tea" });
  const names = (region: string) => within(screen.getByRole("region", { name: region })).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
  expect(names("Drinks")).toEqual(["Coffee", "Tea"]);
  cleanup();
  firstClient.clear();
  vi.mocked(api.get).mockResolvedValue({ data: data([{ ...tea, sortOrder: 0 }, meal, { ...coffee, sortOrder: 1 }]) });
  // Each mount has its own QueryClient, as with separate customers or a reload.
  for (let visitor = 0; visitor < 2; visitor++) {
    const client = setup();
    await screen.findByRole("heading", { name: "Tea" });
    expect(names("Drinks")).toEqual(["Tea", "Coffee"]);
    expect(names("Meals")).toEqual(["Meal"]);
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    cleanup();
    client.clear();
  }
  expect(api.get).toHaveBeenCalledTimes(3);
  expect(api.get).toHaveBeenLastCalledWith("/menu/cafe", { signal: expect.any(AbortSignal) });
});
it("shows a recovery state for unavailable menus", async () => {
  vi.mocked(api.get).mockRejectedValue({
    isAxiosError: true,
    response: { status: 404 },
  });
  setup();
  expect(
    await screen.findByRole("heading", { name: "Menu unavailable" }),
  ).toBeInTheDocument();
});

it("renders the current shop banner above its menu identity", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...menu,
      shop: { ...menu.shop, bannerUrl: "https://example.com/cafe/banner.webp" },
    },
  });
  setup();
  const banner = await screen.findByRole("img", { name: "Cafe banner" });
  expect(banner).toHaveAttribute("src", "https://example.com/cafe/banner.webp");
  expect(
    banner.compareDocumentPosition(
      screen.getByRole("heading", { name: "Cafe" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("keeps the menu usable when the banner is absent", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: menu });
  setup();
  await screen.findByRole("heading", { name: "Cafe" });
  expect(
    screen.queryByRole("img", { name: "Cafe banner" }),
  ).not.toBeInTheDocument();
});

it("hides a broken banner while keeping the logo and menu available", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...menu,
      shop: { ...menu.shop, bannerUrl: "https://example.com/broken.webp" },
    },
  });
  setup();
  fireEvent.error(await screen.findByRole("img", { name: "Cafe banner" }));
  expect(
    screen.queryByRole("img", { name: "Cafe banner" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Cafe logo" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cafe" })).toBeInTheDocument();
});
