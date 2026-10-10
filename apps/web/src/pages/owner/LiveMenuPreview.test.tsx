import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicMenuResponse, UserMembership } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { api } from "../../lib/api/client";
import { LiveMenuPreview } from "./LiveMenuPreview";
vi.mock("../../lib/api/client", () => ({ api: { get: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const membership: UserMembership = {
  id: "member",
  shopId: "a",
  role: "OWNER",
  shop: { id: "a", name: "Cafe", slug: "cafe", isActive: true },
};
const product: PublicMenuResponse["products"][number] = {
  id: "a",
  categoryId: null,
  name: "Tea",
  slug: "tea",
  description: null,
  price: "12.50",
  status: "SOLD_OUT",
  isOrderable: false,
  isFeatured: true,
  imageUrl: null,
  sortOrder: 0,
  featuredSortOrder: 0,
};
const menu: PublicMenuResponse = {
  shop: {
    name: "Cafe",
    slug: "cafe",
    description: null,
    primaryColor: "#123456",
    menuLayout: "list",
  },
  products: [product],
  categories: [],
  featuredProducts: [product],
};
function setup(
  props: Parameters<typeof LiveMenuPreview>[0] = {},
  active = membership,
) {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ActiveShopContext.Provider value={active}>
        <LiveMenuPreview {...props} />
      </ActiveShopContext.Provider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}
it("renders branding drafts with shared menu content while preserving the published cache", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: menu });
  const { client } = setup({
    unsaved: true,
    draft: {
      name: "Draft cafe",
      primaryColor: "#AABBCC",
      accentColor: "#112233",
      menuLayout: "grid",
      logoUrl: "blob:logo",
      bannerUrl: "blob:banner",
    },
  });
  await screen.findByRole("heading", { name: "Draft cafe" });
  const region = screen.getByRole("region", { name: "Customer menu preview" });
  expect(
    within(region).queryByRole("switch", { name: "Dark appearance" }),
  ).not.toBeInTheDocument();
  const rendered = region.querySelector<HTMLElement>(".public-menu")!;
  expect(rendered).toHaveAttribute("data-layout", "grid");
  expect(rendered.style.getPropertyValue("--menu-primary")).toBe("#AABBCC");
  expect(rendered.style.getPropertyValue("--menu-accent")).toBe("#112233");
  expect(screen.getByRole("img", { name: "Draft cafe logo" })).toHaveAttribute(
    "src",
    "blob:logo",
  );
  expect(
    screen.getByRole("img", { name: "Draft cafe banner" }),
  ).toHaveAttribute("src", "blob:banner");
  expect(
    within(screen.getByRole("region", { name: "Featured" })).getByText(
      "Sold out",
    ),
  ).toBeInTheDocument();
  expect(client.getQueryData(["public-menu", "cafe"])).toEqual(menu);
  expect(
    screen.getByText(/Showing your unsaved branding changes/),
  ).toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Desktop" }));
  const display = screen.getByRole("region", {
    name: "Menu inside desktop display",
  });
  expect(
    within(display).getByRole("heading", { name: "Draft cafe" }),
  ).toBeInTheDocument();
  expect(
    within(display).getByRole("img", { name: "Draft cafe banner" }),
  ).toHaveAttribute("src", "blob:banner");
  expect(
    display
      .querySelector<HTMLElement>(".public-menu")!
      .style.getPropertyValue("--menu-primary"),
  ).toBe("#AABBCC");
});
it("updates immediately when saved menu data is invalidated and switches preview widths", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: menu });
  const { client } = setup();
  await screen.findByRole("heading", { name: "Cafe" });
  expect(
    within(screen.getByRole("region", { name: "Menu inside phone" })).getByRole(
      "heading",
      { name: "Cafe" },
    ),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Desktop" }));
  expect(
    screen.queryByRole("region", { name: "Menu inside phone" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const display = screen.getByRole("region", {
    name: "Menu inside desktop display",
  });
  expect(
    within(display).getByRole("heading", { name: "Cafe" }),
  ).toBeInTheDocument();
  expect(display).toHaveAttribute("tabindex", "0");
  expect(
    within(display).queryByRole("switch", { name: "Dark appearance" }),
  ).not.toBeInTheDocument();
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...menu,
      products: [{ ...product, name: "Updated tea" }],
      featuredProducts: [],
    },
  });
  await act(() =>
    client.invalidateQueries({ queryKey: ["public-menu", "cafe"] }),
  );
  expect(
    await screen.findByRole("heading", { name: "Updated tea" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Featured" }),
  ).not.toBeInTheDocument();
  expect(
    within(display).getByRole("heading", { name: "Updated tea" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Phone" }));
  expect(
    screen.queryByRole("region", { name: "Menu inside desktop display" }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Menu inside phone" })).getByRole(
      "heading",
      { name: "Updated tea" },
    ),
  ).toBeInTheDocument();
});
it("keeps menus scoped to the selected shop on shop switches", async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      ...menu,
      shop: { ...menu.shop, name: url.endsWith("other") ? "Other" : "Cafe" },
    },
  }));
  const { client, rerender } = setup();
  await screen.findByRole("heading", { name: "Cafe" });
  rerender(
    <QueryClientProvider client={client}>
      <ActiveShopContext.Provider
        value={{
          ...membership,
          shopId: "b",
          shop: { ...membership.shop, id: "b", slug: "other" },
        }}
      >
        <LiveMenuPreview />
      </ActiveShopContext.Provider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Other" });
  expect(
    screen.queryByRole("heading", { name: "Cafe" }),
  ).not.toBeInTheDocument();
  expect(api.get).toHaveBeenLastCalledWith("/menu/other", {
    signal: expect.any(AbortSignal),
  });
});
it("shows recovery on refresh failure instead of claiming cached data is current", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("offline"));
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "preview is unavailable",
  );
  vi.mocked(api.get).mockResolvedValue({ data: menu });
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Refresh menu" }));
  expect(
    await screen.findByRole("heading", { name: "Cafe" }),
  ).toBeInTheDocument();
});
it("does not fetch for a non-owner", () => {
  setup({}, { ...membership, role: "CASHIER" });
  expect(screen.getByRole("alert")).toHaveTextContent("owner");
  expect(api.get).not.toHaveBeenCalled();
});
