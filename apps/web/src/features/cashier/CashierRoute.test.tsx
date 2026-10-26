import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import type { UserMembership } from "@paserve/contracts";
import { ActiveShopContext } from "../shops/active-shop";
import { getShopMembership } from "../shops/api/context";
import { CashierRoute } from "./CashierRoute";
import { CashierPage } from "../../pages/cashier/CashierPage";

vi.mock("../shops/api/context", () => ({ getShopMembership: vi.fn() }));
const member = (role: UserMembership["role"]): UserMembership => ({
  id: "member-a",
  shopId: "shop-a",
  role,
  shop: { id: "shop-a", name: "Cafe A", slug: "cafe-a", isActive: true },
});
afterEach(() => vi.resetAllMocks());
function SignIn() {
  return <h1>Sign in {useLocation().state?.returnTo}</h1>;
}
function setup(client = new QueryClient()) {
  client.setQueryData(["auth", "me"], { user: { id: "user-a" } });
  render(
    <QueryClientProvider client={client}>
      <ActiveShopContext.Provider value={member("OWNER")}>
        <MemoryRouter initialEntries={["/app/shops/shop-a/cashier"]}>
          <Routes>
            <Route path="/app/shops/:shopId/cashier" element={<CashierRoute />}>
              <Route index element={<CashierPage />} />
            </Route>
            <Route path="/login" element={<SignIn />} />
            <Route path="/app/shops" element={<h1>Choose shop</h1>} />
            <Route path="/app/shops/shop-a" element={<h1>Shop overview</h1>} />
          </Routes>
        </MemoryRouter>
      </ActiveShopContext.Provider>
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
it.each(["CASHIER", "OWNER", "ADMIN", "MANAGER"] as const)(
  "allows a live %s membership",
  async (role) => {
    vi.mocked(getShopMembership).mockResolvedValue(member(role));
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Checking cashier access");
    expect(document.querySelector(".loading-skeleton .skeleton-access-camera")).not.toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Cashier workspace" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Cashier workspace" }),
    ).toBeInTheDocument();
    expect(getShopMembership).toHaveBeenCalledWith(
      "shop-a",
      expect.any(AbortSignal),
    );
    expect(document.querySelector(".skeleton-access")).toBeNull();
    expect(
      screen.getByRole("group", {
        name: `Active shop: Cafe A. Role: ${role.toLowerCase()}.`,
      }),
    ).toBeInTheDocument();
  },
);
it("denies kitchen staff despite the enclosing OWNER context", async () => {
  vi.mocked(getShopMembership).mockResolvedValue(member("KITCHEN"));
  setup();
  expect(
    await screen.findByRole("heading", { name: "Shop overview" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Cashier workspace" }),
  ).not.toBeInTheDocument();
});
it.each([400, 403, 404])(
  "fails closed for unavailable shop access (%s)",
  async (status) => {
    vi.mocked(getShopMembership).mockRejectedValue(failure(status));
    setup();
    expect(
      await screen.findByRole("heading", { name: "Cashier access required" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  },
);
it("returns an expired session to login with the cashier destination", async () => {
  vi.mocked(getShopMembership).mockRejectedValue(failure(401));
  setup();
  expect(
    await screen.findByRole("heading", {
      name: "Sign in /app/shops/shop-a/cashier",
    }),
  ).toBeInTheDocument();
});
it("keeps tools hidden during a network failure and permits retry", async () => {
  vi.mocked(getShopMembership)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(member("CASHIER"));
  setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Cashier workspace" }),
  ).toBeInTheDocument();
});
it("keeps a recent verified workspace visible during revalidation and blocks a revoked role", async () => {
  vi.mocked(getShopMembership).mockResolvedValueOnce(member("CASHIER"));
  const client = setup();
  await screen.findByRole("heading", { name: "Cashier workspace" });
  let resolve!: (value: UserMembership) => void;
  vi.mocked(getShopMembership).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    void client.invalidateQueries({ queryKey: ["cashier", "access"] });
  });
  await waitFor(() => expect(getShopMembership).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("heading", { name: "Cashier workspace" })).toBeVisible();
  expect(screen.queryByRole("dialog", { name: /Checking cashier access/ })).not.toBeInTheDocument();
  await act(async () => resolve(member("KITCHEN")));
  expect(
    await screen.findByRole("heading", { name: "Shop overview" }),
  ).toBeInTheDocument();
});
it("does not trust a cached cashier grant when entering the route", async () => {
  const client = new QueryClient();
  client.setQueryData(
    ["cashier", "access", "user-a", "shop-a"],
    member("CASHIER"),
  );
  vi.mocked(getShopMembership).mockRejectedValue(failure(404));
  setup(client);
  expect(
    screen.queryByRole("heading", { name: "Cashier workspace" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "Cashier access required" }),
  ).toBeInTheDocument();
});
