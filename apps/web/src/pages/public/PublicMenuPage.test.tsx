import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      <MemoryRouter initialEntries={["/menu/cafe"]}>
        <Routes>
          <Route path="/menu/:shopSlug" element={<PublicMenuPage />} />
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
