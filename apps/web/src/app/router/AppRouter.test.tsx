import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { AppRouter } from "./AppRouter";
import { getCurrentUser } from "../../features/auth/api/session";
import { api } from "../../lib/api/client";
import { useCustomerTables } from "../../features/shops/customer-table";

vi.mock("../../lib/api/client", () => ({ api: { get: vi.fn() } }));

vi.mock("../../features/auth/api/session", () => ({
  currentUserKey: ["auth", "me"],
  getCurrentUser: vi.fn(),
  logoutAccount: vi.fn(),
}));
vi.mock("../../pages/public/LoginPage", () => ({
  LoginPage: () => <h1>Public sign in</h1>,
}));
vi.mock("../../pages/public/RegisterPage", () => ({
  RegisterPage: () => <h1>Public registration</h1>,
}));

beforeEach(() => {
  vi.resetAllMocks();
  useCustomerTables.setState({ codes: {}, resolved: {} });
});
afterEach(() => {
  useCustomerTables.setState({ codes: {}, resolved: {} });
  window.history.replaceState(null, "", "/");
});

it.each(["T12", "t_9dd21e8326b440b2a73f22d4f16c038a"])(
  "routes a direct scanned table link (%s) to its public menu without login",
  async (code) => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        shop: { name: "Table Cafe", slug: "shop", description: null },
        table: { shopSlug: "shop", code, number: "12" },
        products: [],
        categories: [],
        featuredProducts: [],
      },
    });
    renderAt(`/shop/table/${code}`);
    expect(
      await screen.findByRole("heading", { name: "Table Cafe", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ordering for Table 12")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/menu/shop/table/${code}`, {
      signal: expect.any(AbortSignal),
      timeout: 15_000,
    });
    expect(getCurrentUser).not.toHaveBeenCalled();
  },
);

function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppRouter />
    </QueryClientProvider>,
  );
}

it.each([
  "/app",
  "/app/account",
  "/app/onboarding/create-shop",
  "/app/shops",
  "/app/shops/05bcdf9f-d1be-4669-a01c-0b657f5a2f8e",
  "/app/shops/05bcdf9f-d1be-4669-a01c-0b657f5a2f8e/cashier",
  "/app/shops/05bcdf9f-d1be-4669-a01c-0b657f5a2f8e/menu-preview",
  "/app/shops/05bcdf9f-d1be-4669-a01c-0b657f5a2f8e/add-ons",
  "/app/shops/05bcdf9f-d1be-4669-a01c-0b657f5a2f8e/products/example/customize",
])("redirects guests entering %s directly to login", async (path) => {
  const error = new AxiosError("Unauthorized");
  error.response = {
    status: 401,
    statusText: "Unauthorized",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  };
  vi.mocked(getCurrentUser).mockRejectedValue(error);
  renderAt(path);
  expect(
    await screen.findByRole("heading", { name: "Public sign in" }),
  ).toBeInTheDocument();
  expect(window.location.pathname).toBe("/login");
  expect(
    screen.queryByText("Your account is ready. Shop setup comes next."),
  ).not.toBeInTheDocument();
});

it.each(["/app", "/app/account"])(
  "allows a verified user into %s",
  async (path) => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      user: {
        id: "user-id",
        email: "owner@example.com",
        createdAt: "2026-10-08T00:00:00Z",
        firstName: null,
        lastName: null,
        memberships: [],
      },
    });
    renderAt(path);
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/account");
  },
);

it("keeps public registration accessible without authenticating", () => {
  renderAt("/register");
  expect(
    screen.getByRole("heading", { name: "Public registration" }),
  ).toBeInTheDocument();
  expect(getCurrentUser).not.toHaveBeenCalled();
});

it("blocks a direct cashier URL using the live shop role despite a cached OWNER profile", async () => {
  const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
  const membership = {
    id: "member-a",
    shopId,
    role: "KITCHEN" as const,
    shop: { id: shopId, name: "Cafe A", slug: "cafe-a", isActive: true },
  };
  vi.mocked(getCurrentUser).mockResolvedValue({
    user: {
      id: "user-a",
      email: "staff@example.com",
      createdAt: "2026-10-13T00:00:00Z",
      firstName: null,
      lastName: null,
      memberships: [{ ...membership, role: "OWNER" }],
    },
  });
  vi.mocked(api.get).mockResolvedValue({ data: { membership } });
  renderAt(`/app/shops/${shopId}/cashier`);
  expect(
    await screen.findByRole("heading", { name: "Cashier access required" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Cashier workspace" }),
  ).not.toBeInTheDocument();
  expect(
      screen.queryByRole("link", { name: "Cashier" }),
  ).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith(`/shops/${shopId}/membership`, {
    signal: expect.any(AbortSignal),
  });
});

it("blocks a direct cashier URL for a shop outside the authenticated user's memberships", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    user: {
      id: "user-a",
      email: "staff@example.com",
      createdAt: "2026-10-13T00:00:00Z",
      firstName: null,
      lastName: null,
      memberships: [],
    },
  });
  const error = new AxiosError("Not accessible");
  error.response = {
    status: 404,
    statusText: "Not Found",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  };
  vi.mocked(api.get).mockRejectedValue(error);
  renderAt("/app/shops/05bcdf9f-d1be-4669-a01c-0b657f5a2f8e/cashier");
  expect(
    await screen.findByRole("heading", { name: "Shop unavailable" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Cashier workspace" }),
  ).not.toBeInTheDocument();
});

const publicMenu = {
  shop: {
    name: "Cafe North",
    slug: "cafe-north",
    description: "Fresh coffee",
    logoUrl: "https://example.com/north-logo.webp",
    bannerUrl: "https://example.com/north-banner.webp",
    primaryColor: "#123456",
    accentColor: "#ABCDEF",
    menuLayout: "grid",
  },
  categories: [{ id: "drinks", name: "Drinks" }],
  products: [
    {
      id: "coffee",
      categoryId: "drinks",
      name: "Coffee",
      price: "120.00",
      status: "AVAILABLE",
      description: null,
      imageUrl: null,
    },
  ],
  featuredProducts: [],
};

it.each(["/cafe-north", "/menu/cafe-north"])(
  "renders the resolved customer menu at %s without authentication",
  async (path) => {
    vi.mocked(api.get).mockResolvedValue({ data: publicMenu });
    renderAt(path);
    expect(
      await screen.findByRole("heading", { name: "Cafe North" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Drinks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coffee" })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/menu/cafe-north", {
      signal: expect.any(AbortSignal),
      timeout: 15_000,
    });
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(path);
  },
);

it("shows loading followed by an empty shop menu for a guest", async () => {
  let resolveMenu!: (value: unknown) => void;
  vi.mocked(api.get).mockReturnValue(
    new Promise((resolve) => {
      resolveMenu = resolve;
    }),
  );
  renderAt("/cafe-north");
  expect(screen.getByRole("status")).toHaveTextContent("Loading menu");
  await act(async () =>
    resolveMenu({ data: { ...publicMenu, categories: [], products: [] } }),
  );
  expect(
    await screen.findByRole("heading", { name: "Cafe North" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("No items are available on this menu yet."),
  ).toBeInTheDocument();
  expect(getCurrentUser).not.toHaveBeenCalled();
});

it.each(["missing-shop", "inactive-shop", "bad_slug"])(
  "shows a safe unavailable state for %s without redirecting a guest to sign in",
  async (slug) => {
    vi.mocked(api.get).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    });
    renderAt(`/${slug}`);
    expect(
      await screen.findByRole("heading", { name: "Menu unavailable" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This menu is unavailable.",
    );
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/${slug}`);
    expect(
      screen.queryByRole("heading", { name: "Cafe North" }),
    ).not.toBeInTheDocument();
  },
);

it("lets a guest retry a failed menu request", async () => {
  vi.mocked(api.get)
    .mockRejectedValueOnce(new Error("Network error"))
    .mockResolvedValueOnce({ data: publicMenu });
  renderAt("/cafe-north");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your connection",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Cafe North" }),
  ).toBeInTheDocument();
  expect(getCurrentUser).not.toHaveBeenCalled();
});

it("resolves a new shop context when navigating between public slugs", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ data: publicMenu });
  renderAt("/cafe-north");
  await screen.findByRole("heading", { name: "Cafe North" });
  vi.mocked(api.get).mockResolvedValueOnce({
    data: {
      ...publicMenu,
      shop: {
        ...publicMenu.shop,
        name: "Cafe South",
        slug: "cafe-south",
        logoUrl: "https://example.com/south-logo.webp",
        bannerUrl: "https://example.com/south-banner.webp",
        primaryColor: "#FFFFFF",
        accentColor: "#000000",
        menuLayout: "compact",
      },
      products: [],
      categories: [],
    },
  });
  act(() => {
    window.history.pushState(null, "", "/cafe-south");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(
    screen.queryByRole("heading", { name: "Cafe North" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "Cafe South" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Drinks" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Coffee" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Cafe South logo" })).toHaveAttribute(
    "src",
    "https://example.com/south-logo.webp",
  );
  expect(
    screen.getByRole("img", { name: "Cafe South banner" }),
  ).toHaveAttribute("src", "https://example.com/south-banner.webp");
  expect(
    screen.queryByRole("img", { name: "Cafe North logo" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("img", { name: "Cafe North banner" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("data-layout", "compact");
  expect(
    screen.getByRole("main").style.getPropertyValue("--menu-primary"),
  ).toBe("#FFFFFF");
  expect(screen.getByRole("main").style.getPropertyValue("--menu-accent")).toBe(
    "#000000",
  );
  expect(api.get).toHaveBeenLastCalledWith("/menu/cafe-south", {
    signal: expect.any(AbortSignal),
      timeout: 15_000,
  });
  expect(getCurrentUser).not.toHaveBeenCalled();
});

it.each(["/api", "/admin", "/shops", "/menu", "/unknown/nested"])(
  "does not resolve reserved or unmatched path %s as a shop",
  (path) => {
    renderAt(path);
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(getCurrentUser).not.toHaveBeenCalled();
  },
);

it("uses the current shop's price when shops sell products with the same name", async () => {
  vi.mocked(api.get).mockImplementation(async (url) => {
    const south = url === "/menu/cafe-south";
    const product = {
      ...publicMenu.products[0],
      id: south ? "south-coffee" : "north-coffee",
      price: south ? "250.99" : "120.01",
    };
    return {
      data: {
        ...publicMenu,
        shop: {
          ...publicMenu.shop,
          name: south ? "Cafe South" : "Cafe North",
          slug: south ? "cafe-south" : "cafe-north",
        },
        products: [product],
        featuredProducts: [],
      },
    };
  });
  renderAt("/cafe-north");
  expect(
    await screen.findByRole("heading", { name: "Cafe North" }),
  ).toBeInTheDocument();
  expect(screen.getByText("₱120.01")).toBeInTheDocument();
  expect(screen.queryByText("₱250.99")).not.toBeInTheDocument();
  act(() => {
    window.history.pushState(null, "", "/cafe-south");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(
    await screen.findByRole("heading", { name: "Cafe South" }),
  ).toBeInTheDocument();
  expect(screen.getByText("₱250.99")).toBeInTheDocument();
  expect(screen.queryByText("₱120.01")).not.toBeInTheDocument();
  expect(screen.getAllByRole("heading", { name: "Coffee" })).toHaveLength(1);
  expect(getCurrentUser).not.toHaveBeenCalled();
});

it("keeps sign in accessible without resolving a shop", () => {
  renderAt("/login");
  expect(
    screen.getByRole("heading", { name: "Public sign in" }),
  ).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
  expect(getCurrentUser).not.toHaveBeenCalled();
});

it("keeps the root registration destination", async () => {
  renderAt("/");
  expect(
    await screen.findByRole("heading", { name: "Public registration" }),
  ).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
  expect(getCurrentUser).not.toHaveBeenCalled();
});

it("keeps the connection route separate from public shop resolution", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { api: "ok", database: "ok" } });
  renderAt("/connection");
  expect(
    screen.getByRole("heading", { name: "PaServe connection" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("ok / ok")).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith("/health");
  expect(getCurrentUser).not.toHaveBeenCalled();
});
