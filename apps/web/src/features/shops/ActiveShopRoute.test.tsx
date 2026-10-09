import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import type { UserMembership } from "@paserve/contracts";
import { ActiveShopRoute } from "./ActiveShopRoute";
import { getShopMembership } from "./api/context";
import { activeShopKey, rememberShop, rememberedShop } from "./active-shop";
import { ActiveShopPage } from "../../pages/owner/ActiveShopPage";
import {
  ResolveActiveShop,
  ShopSelectionPage,
} from "../../pages/owner/ShopSelectionPage";

vi.mock("./api/context", () => ({ getShopMembership: vi.fn() }));
const member = (
  id: string,
  role: UserMembership["role"] = "OWNER",
): UserMembership => ({
  id: `member-${id}`,
  shopId: id,
  role,
  shop: { id, name: `Cafe ${id}`, slug: `cafe-${id}`, isActive: true },
});
afterEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
});
function setup(
  path: string,
  memberships: UserMembership[],
  client = new QueryClient(),
) {
  client.setQueryData(["auth", "me"], { user: { id: "user-a", memberships } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<ResolveActiveShop />} />
          <Route path="/app/account" element={<h1>Account</h1>} />
          <Route path="/login" element={<h1>Sign in</h1>} />
          <Route path="/app/shops" element={<ShopSelectionPage />} />
          <Route path="/app/shops/:shopId" element={<ActiveShopRoute />}>
            <Route index element={<ActiveShopPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function failure(status: number) {
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

it("resolves the only available shop and saves it after live validation", async () => {
  vi.mocked(getShopMembership).mockResolvedValue(member("a"));
  setup("/app", [
    member("a"),
    { ...member("b"), shop: { ...member("b").shop, isActive: false } },
  ]);
  expect(
    await screen.findByRole("heading", { name: "Cafe a" }),
  ).toBeInTheDocument();
  expect(getShopMembership).toHaveBeenCalledWith("a", expect.any(AbortSignal));
  expect(rememberedShop("user-a")).toBe("a");
});
it("offers an explicit choice for multiple shops and switches role and context", async () => {
  vi.mocked(getShopMembership).mockImplementation(async (id) =>
    member(id, id === "a" ? "OWNER" : "CASHIER"),
  );
  setup("/app", [member("a"), member("b", "CASHIER")]);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: /Cafe a/ }));
  expect(await screen.findByText("Your role: owner")).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Switch shop" }));
  await user.click(await screen.findByRole("link", { name: /Cafe b/ }));
  expect(await screen.findByText("Your role: cashier")).toBeInTheDocument();
  expect(screen.queryByText("Your role: owner")).not.toBeInTheDocument();
  expect(rememberedShop("user-a")).toBe("b");
});
it("restores this user's selection and ignores another user's hint", async () => {
  rememberShop("user-b", "a");
  rememberShop("user-a", "b");
  vi.mocked(getShopMembership).mockResolvedValue(member("b"));
  setup("/app", [member("a"), member("b")]);
  expect(
    await screen.findByRole("heading", { name: "Cafe b" }),
  ).toBeInTheDocument();
});
it("ignores a saved shop that is no longer in the user's available memberships", async () => {
  rememberShop("user-a", "removed");
  setup("/app", [member("a"), member("b")]);
  expect(
    await screen.findByRole("heading", { name: "Choose a shop" }),
  ).toBeInTheDocument();
  expect(getShopMembership).not.toHaveBeenCalled();
});
it("opens the account when no shops are available", async () => {
  setup("/app", []);
  expect(
    await screen.findByRole("heading", { name: "Account" }),
  ).toBeInTheDocument();
});
it.each([400, 403, 404])(
  "rejects inaccessible URL context (%s), clears its hint, and never shows cached business data",
  async (status) => {
    rememberShop("user-a", "a");
    const client = new QueryClient();
    client.setQueryData(activeShopKey("user-a", "a"), member("a"));
    vi.mocked(getShopMembership).mockRejectedValue(failure(status));
    setup("/app/shops/a", [member("a"), member("b")], client);
    expect(
      screen.queryByRole("heading", { name: "Cafe a" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Shop unavailable" }),
    ).toBeInTheDocument();
    expect(rememberedShop("user-a")).toBeNull();
  },
);
it("honors the URL over the saved hint and lets network errors be retried", async () => {
  rememberShop("user-a", "a");
  vi.mocked(getShopMembership)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(member("b"));
  setup("/app/shops/b", [member("a"), member("b")]);
  expect(
    await screen.findByRole("heading", { name: "Unable to open this shop" }),
  ).toBeInTheDocument();
  expect(rememberedShop("user-a")).toBe("a");
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Cafe b" }),
  ).toBeInTheDocument();
});
it("redirects an expired session to sign in", async () => {
  vi.mocked(getShopMembership).mockRejectedValue(failure(401));
  setup("/app/shops/a", [member("a")]);
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
});

it("distinguishes duplicate shop names by slug and opens the validated matching shop", async () => {
  const a = {
    ...member("a"),
    shop: { ...member("a").shop, name: "Same Cafe" },
  };
  const b = {
    ...member("b"),
    shop: { ...member("b").shop, name: "Same Cafe" },
  };
  vi.mocked(getShopMembership).mockResolvedValue(b);
  setup("/app/shops", [a, b]);
  const user = userEvent.setup();
  expect(screen.getAllByRole("link", { name: /Same Cafe/ })).toHaveLength(2);
  await user.type(
    screen.getByRole("searchbox", { name: "Search shops" }),
    "CAFE-B",
  );
  expect(screen.getAllByRole("link", { name: /Same Cafe/ })).toHaveLength(1);
  await user.click(screen.getByRole("link", { name: /Same Cafe/ }));
  expect(getShopMembership).toHaveBeenCalledWith("b", expect.any(AbortSignal));
  expect(
    await screen.findByRole("heading", { name: "Same Cafe" }),
  ).toBeInTheDocument();
});

it("searches roles, recovers from no results, and restores search focus", async () => {
  setup("/app/shops", [member("a"), member("b", "KITCHEN")]);
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox", { name: "Search shops" });
  await user.type(search, "kitchen");
  expect(
    screen.queryByRole("link", { name: /Cafe a/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Cafe b/ })).toBeInTheDocument();
  await user.clear(search);
  await user.type(search, "no-such-place");
  expect(
    screen.getByRole("heading", { name: "No shops found" }),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Show all shops" }),
  );
  expect(search).toHaveFocus();
  expect(search).toHaveValue("");
  expect(screen.getByRole("link", { name: /Cafe a/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Cafe b/ })).toBeInTheDocument();
});

it("shows a last-visited hint without changing the active shop or exposing inactive shops", () => {
  rememberShop("user-a", "b");
  setup("/app/shops", [
    member("a"),
    member("b"),
    {
      ...member("hidden"),
      shop: { ...member("hidden").shop, isActive: false },
    },
  ]);
  expect(screen.getByRole("link", { name: /Cafe b/ })).toHaveTextContent(
    "Last visited",
  );
  expect(screen.getByRole("link", { name: /Cafe a/ })).not.toHaveTextContent(
    "Last visited",
  );
  expect(
    screen.queryByRole("link", { name: /Cafe hidden/ }),
  ).not.toBeInTheDocument();
  expect(getShopMembership).not.toHaveBeenCalled();
  expect(rememberedShop("user-a")).toBe("b");
  expect(screen.getAllByRole("link", { name: "Create shop" })).toHaveLength(1);
});

it("keeps a truthful empty state with one onboarding action", () => {
  setup("/app/shops", []);
  expect(
    screen.getByText("No available shops yet. Create a shop to get started."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Create shop" })).toHaveAttribute(
    "href",
    "/app/onboarding/create-shop",
  );
});
