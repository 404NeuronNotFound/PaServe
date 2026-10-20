import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import type { UserMembership } from "@paserve/contracts";
import { OwnerDashboardLayout } from "./OwnerDashboardLayout";
import { ProtectedRoute } from "../../features/auth/components/ProtectedRoute";
import { ActiveShopRoute } from "../../features/shops/ActiveShopRoute";
import { getCurrentUser, logoutAccount } from "../../features/auth/api/session";
import {
  getShopMembership,
  getShopSettings,
} from "../../features/shops/api/context";
import { rememberShop, rememberedShop } from "../../features/shops/active-shop";
import { ActiveShopPage } from "../../pages/owner/ActiveShopPage";
import { ShopSettingsPage } from "../../pages/owner/ShopSettingsPage";
import { MenuPreviewPage } from "../../pages/owner/MenuPreviewPage";
import { api } from "../../lib/api/client";
import { useFeedbackStore } from "../../app/stores/feedback";

vi.mock("../../features/auth/api/session", () => ({
  currentUserKey: ["auth", "me"],
  getCurrentUser: vi.fn(),
  logoutAccount: vi.fn(),
}));
vi.mock("../../features/shops/api/context", () => ({
  getShopMembership: vi.fn(),
  getShopSettings: vi.fn(),
  updateShop: vi.fn(),
}));
const member = (
  id: string,
  role: UserMembership["role"] = "OWNER",
): UserMembership => ({
  id: `membership-${id}`,
  shopId: id,
  role,
  shop: {
    id,
    name: `Cafe ${id.toUpperCase()}`,
    slug: `cafe-${id}`,
    isActive: true,
  },
});
const profile = {
  user: {
    id: "user-a",
    email: "owner@example.com",
    createdAt: "2026-10-09",
    firstName: null,
    lastName: null,
    memberships: [member("a"), member("b", "ADMIN")],
  },
};
beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue(profile);
  vi.mocked(getShopMembership).mockImplementation(async (id) =>
    member(id, id === "b" ? "ADMIN" : "OWNER"),
  );
  vi.mocked(getShopSettings).mockResolvedValue({
    shop: {
      ...member("a").shop,
      description: null,
      createdAt: "2026-10-09",
      displayName: null,
      phone: null,
      contactEmail: null,
      website: null,
      address: null,
      operatingHours: null,
    },
  });
});
afterEach(() => {
  focusManager.setFocused(undefined);
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.removeItem("paserve.sidebar.collapsed");
  useFeedbackStore.getState().clear();
});
it("preserves a settings draft when returning to the browser window", async () => {
  setup("/app/shops/a/settings");
  const user = userEvent.setup();
  const name = await screen.findByLabelText("Business name (required)");
  await user.clear(name);
  await user.type(name, "Unsaved cafe name");
  const sessionCalls = vi.mocked(getCurrentUser).mock.calls.length;
  const membershipCalls = vi.mocked(getShopMembership).mock.calls.length;
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() =>
    expect(vi.mocked(getCurrentUser).mock.calls.length).toBeGreaterThan(
      sessionCalls,
    ),
  );
  expect(getShopMembership).toHaveBeenCalledTimes(membershipCalls);
  expect(screen.getByLabelText("Business name (required)")).toHaveValue(
    "Unsaved cafe name",
  );
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});
function setup(path = "/app/shops/a") {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/app/shops/:shopId"
            element={
              <ProtectedRoute>
                <ActiveShopRoute />
              </ProtectedRoute>
            }
          >
            <Route element={<OwnerDashboardLayout />}>
              <Route index element={<ActiveShopPage />} />
              <Route path="settings" element={<ShopSettingsPage />} />
              <Route path="menu-preview" element={<MenuPreviewPage />} />
              <Route
                path="products/:productId/customize"
                element={<h1>Product customization</h1>}
              />
            </Route>
          </Route>
          <Route path="/app/account" element={<h1>Your account page</h1>} />
          <Route path="/app/shops" element={<h1>Shop picker</h1>} />
          <Route path="/login" element={<h1>Sign in</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it("lets the owner inspect the menu within the authenticated workspace", async () => {
  const getMenu = vi.spyOn(api, "get").mockResolvedValue({
    data: {
      shop: {
        name: "Cafe A",
        slug: "cafe-a",
        description: null,
        menuLayout: "grid",
      },
      categories: [],
      products: [],
      featuredProducts: [],
    },
  });
  try {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Cafe A" });
    await user.click(screen.getByRole("button", { name: "Menu & catalog" }));
    await user.click(screen.getByRole("link", { name: "Menu preview" }));
    expect(
      await screen.findByRole("heading", { name: "Menu preview" }),
    ).toBeInTheDocument();
    const preview = screen.getByRole("region", {
      name: "Customer menu preview",
    });
    expect(
      await within(preview).findByRole("heading", { name: "Cafe A" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Account menu")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Shop navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Menu preview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(getMenu).toHaveBeenCalledWith("/menu/cafe-a", {
      signal: expect.any(AbortSignal),
    });
    expect(logoutAccount).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Sign in" }),
    ).not.toBeInTheDocument();
  } finally {
    getMenu.mockRestore();
  }
});
function denied(status: number) {
  const error = new AxiosError("Denied");
  error.response = {
    status,
    statusText: "Denied",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  };
  return error;
}

it("uses one shared header/main and correct navigation across page outlets", async () => {
  setup();
  const user = userEvent.setup();
  expect(
    await screen.findByRole("heading", { name: "Cafe A" }),
  ).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Shop navigation" });
  expect(within(nav).getByRole("link", { name: "Orders" })).toHaveAttribute(
    "href", "/app/shops/a/orders",
  );
  expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await user.click(within(nav).getByRole("button", { name: "Shop management" }));
  await user.click(within(nav).getByRole("link", { name: "Shop settings" }));
  expect(
    await screen.findByRole("heading", { name: "Shop settings" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("banner")).toHaveLength(1);
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(
    within(
      screen.getByRole("navigation", { name: "Shop navigation" }),
    ).getByRole("link", { name: "Shop settings" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    within(
      screen.getByRole("navigation", { name: "Shop navigation" }),
    ).getByRole("link", { name: "Overview" }),
  ).not.toHaveAttribute("aria-current");
});
it("switches to an admin's shop and updates navigation and the page context", async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const switcher = await screen.findByLabelText("Active shop");
  await user.click(switcher);
  await user.click(
    within(switcher.parentElement!).getByRole("button", { name: /Cafe B/ }),
  );
  expect(
    await screen.findByRole("heading", { name: "Cafe B" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Your role: admin")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Orders" })).not.toBeInTheDocument();
  expect(
    within(
      screen.getByRole("navigation", { name: "Shop navigation" }),
    ).queryByRole("link", { name: "Shop settings" }),
  ).not.toBeInTheDocument();
  expect(getShopMembership).toHaveBeenCalledWith("b", expect.any(AbortSignal));
  expect(rememberedShop("user-a")).toBe("b");
});
it("omits the switcher when there is only one available shop", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    user: { ...profile.user, memberships: [member("a")] },
  });
  setup();
  expect(
    await screen.findByRole("heading", { name: "Cafe A" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Active shop")).not.toBeInTheDocument();
});
it("marks only the exact sidebar destination as current", async () => {
  setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const nav = screen.getByRole("navigation", { name: "Shop navigation" });
  expect(
    within(nav).getByRole("link", { name: "Your shops" }),
  ).not.toHaveAttribute("aria-current");
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
it("groups shop work and personal navigation and keeps Products current on customization", async () => {
  setup("/app/shops/a/products/latte/customize");
  await screen.findByRole("heading", { name: "Product customization" });
  const nav = screen.getByRole("navigation", { name: "Shop navigation" });
  const workspace = within(nav).getByRole("group", { name: "Restaurant management" });
  const menu = within(nav).getByRole("group", { name: "Menu management" });
  const account = within(nav).getByRole("group", { name: "Account" });
  expect(
    within(workspace).getByRole("link", { name: "Shop settings", hidden: true }),
  ).toBeInTheDocument();
  expect(
    within(menu)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Products", "Categories", "Add-ons", "Menu preview"]);
  expect(
    within(account).getByRole("link", { name: "Your shops" }),
  ).toHaveAttribute("href", "/app/shops");
  expect(within(menu).getByRole("link", { name: "Products" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
it.each(["ADMIN", "MANAGER", "CASHIER", "KITCHEN"] as const)(
  "preserves sidebar permissions for %s",
  async (role) => {
    localStorage.setItem("paserve.sidebar.collapsed", "true");
    vi.mocked(getShopMembership).mockResolvedValue(member("a", role));
    setup();
    await screen.findByRole("heading", { name: "Cafe A" });
    const nav = screen.getByRole("navigation", { name: "Shop navigation" });
    const tasks = screen.getByRole("navigation", { name: "Common tasks" });
    expect(within(tasks).getAllByRole("link").map((link) => link.textContent)).toEqual(
      role === "CASHIER" ? ["Cashier"] : role === "KITCHEN" ? ["Kitchen / Barista"]
        : ["Sales dashboard", "Cashier", "Kitchen / Barista", "Products"],
    );
    expect(
      within(nav).queryByRole("link", { name: "Shop settings" }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Menu preview" }),
    ).not.toBeInTheDocument();
    if (role === "ADMIN" || role === "MANAGER") {
      expect(within(nav).getByRole("link", { name: "Sales dashboard" })).toHaveAttribute("href", "/app/shops/a/sales");
      expect(
        within(nav).getByRole("group", { name: "Menu management" }),
      ).toBeInTheDocument();
    } else {
      expect(within(nav).queryByRole("link", { name: "Sales dashboard" })).not.toBeInTheDocument();
      expect(
        within(nav).queryByRole("group", { name: "Menu management" }),
      ).not.toBeInTheDocument();
      expect(
        within(nav).queryByRole("link", { name: "Products" }),
      ).not.toBeInTheDocument();
    }
    expect(
      within(nav).getByRole("link", { name: "Your account" }),
    ).toBeInTheDocument();
  },
);
it("supports keyboard shop choices, Escape and outside dismissal", async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const trigger = screen.getByLabelText("Active shop");
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  const first = within(trigger.parentElement!).getByRole("button", {
    name: /Cafe A/,
  });
  expect(first).toHaveFocus();
  expect(first).toHaveAttribute("aria-current", "true");
  await user.keyboard("{End}");
  expect(
    within(trigger.parentElement!).getByRole("button", { name: /Cafe B/ }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger.parentElement).not.toHaveAttribute("open");
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole("heading", { name: "Cafe A" }));
  expect(trigger.parentElement).not.toHaveAttribute("open");
});
it("supports account-menu keyboard dismissal and account navigation", async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const trigger = screen.getByLabelText("Account menu");
  await user.click(trigger);
  expect(trigger.parentElement).toHaveAttribute("open");
  await user.keyboard("{Escape}");
  expect(trigger.parentElement).not.toHaveAttribute("open");
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(
    within(trigger.parentElement!).getByRole("link", { name: "Your account" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Your account page" }),
  ).toBeInTheDocument();
});
it("clears remembered context and private cache when signing out from the shell", async () => {
  vi.mocked(logoutAccount).mockResolvedValue();
  const client = setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  rememberShop("user-a", "a");
  client.setQueryData(["private"], { secret: true });
  await user.click(screen.getByLabelText("Account menu"));
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  expect(logoutAccount).toHaveBeenCalledTimes(1);
  expect(rememberedShop("user-a")).toBeNull();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
it("shows a retryable sign-out error without clearing the user's context", async () => {
  vi.mocked(logoutAccount).mockRejectedValue(new Error("Offline"));
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  await user.click(screen.getByLabelText("Account menu"));
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn’t sign you out",
  );
  expect(rememberedShop("user-a")).toBe("a");
});
it("shows the shell during shop loading with tenant links withheld", async () => {
  vi.mocked(getShopMembership).mockImplementation(() => new Promise(() => {}));
  setup();
  expect(await screen.findByText("Checking shop access…")).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Shop navigation" });
  expect(
    within(nav).queryByRole("link", { name: "Overview" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Account menu")).toBeInTheDocument();
});
it("keeps recovery navigation for rejected shop IDs", async () => {
  vi.mocked(getShopMembership).mockRejectedValue(denied(404));
  setup();
  const user = userEvent.setup();
  expect(
    await screen.findByRole("heading", { name: "Shop unavailable" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Overview" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Choose another shop" }));
  expect(
    await screen.findByRole("heading", { name: "Shop picker" }),
  ).toBeInTheDocument();
});
it("keeps guest requests outside the dashboard", async () => {
  vi.mocked(getCurrentUser).mockRejectedValue(denied(401));
  setup("/app/shops/a/settings");
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  expect(getShopMembership).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Account menu")).not.toBeInTheDocument();
});
it("toggles navigation with an accessible control and Escape returns focus", async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  // jsdom has no responsive layout; the control's state is still testable.
  const toggle = screen.getByRole("button", { name: "Navigation" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const overview = within(
    screen.getByRole("navigation", { name: "Shop navigation" }),
  ).getByRole("link", { name: "Overview" });
  overview.focus();
  await user.keyboard("{Escape}");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveFocus();
});

it("collapses setup groups and toggles them with the keyboard", async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const toggle = screen.getByRole("button", { name: "Menu & catalog" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(within(screen.getByRole("navigation", { name: "Shop navigation" })).queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
  toggle.focus();
  await user.keyboard("{Enter}");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(screen.getByRole("navigation", { name: "Shop navigation" })).getByRole("link", { name: "Products" })).toHaveAttribute("href", "/app/shops/a/products");
  await user.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});
it("restores an icon rail preference and keeps every permitted destination accessible", async () => {
  localStorage.setItem("paserve.sidebar.collapsed", "true");
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const expand = screen.getByRole("button", { name: "Expand sidebar" });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  const nav = screen.getByRole("navigation", { name: "Shop navigation" });
  expect(within(nav).getAllByRole("link")).toHaveLength(14);
  expect(within(nav).getByRole("link", { name: "Sales dashboard" })).toHaveAttribute("href", "/app/shops/a/sales");
  expect(within(nav).getByRole("link", { name: "Products" })).toHaveAttribute("title", "Products");
  await user.click(expand);
  expect(localStorage.getItem("paserve.sidebar.collapsed")).toBe("false");
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-expanded", "true");
  expect(within(screen.getByRole("navigation", { name: "Shop navigation" })).queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(localStorage.getItem("paserve.sidebar.collapsed")).toBe("true");
});
it("uses a distinct icon for every sidebar destination", async () => {
  localStorage.setItem("paserve.sidebar.collapsed", "true");
  setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const nav = screen.getByRole("navigation", { name: "Shop navigation" });
  const icons = within(nav).getAllByRole("link").map(link => link.querySelector("svg")?.innerHTML);
  expect(new Set(icons).size).toBe(icons.length);
});

it("uses full labels and working disclosures on mobile without losing the desktop preference", async () => {
  let onChange: (() => void) | undefined;
  const query = {
    matches: false,
    addEventListener: vi.fn((_type: string, callback: () => void) => { onChange = callback; }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  localStorage.setItem("paserve.sidebar.collapsed", "true");
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const shell = screen.getByRole("main").closest(".dashboard-shell");
  expect(shell).toHaveAttribute("data-sidebar-collapsed", "true");
  act(() => { query.matches = true; onChange?.(); });
  expect(shell).toHaveAttribute("data-sidebar-collapsed", "false");
  await user.click(screen.getByRole("button", { name: "Navigation" }));
  expect(within(screen.getByRole("navigation", { name: "Shop navigation" })).queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Menu & catalog" }));
  expect(within(screen.getByRole("navigation", { name: "Shop navigation" })).getByRole("link", { name: "Products" })).toBeInTheDocument();
  act(() => { query.matches = false; onChange?.(); });
  expect(shell).toHaveAttribute("data-sidebar-collapsed", "true");
  expect(localStorage.getItem("paserve.sidebar.collapsed")).toBe("true");
});

it("still collapses when browser preference storage is blocked", async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Cafe A" });
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  try {
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  } finally {
    storage.mockRestore();
  }
});
