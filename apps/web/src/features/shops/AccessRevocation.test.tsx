import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import type { CurrentUserResponse, UserMembership } from "@paserve/contracts";
import { ProtectedRoute } from "../auth/components/ProtectedRoute";
import { currentUserKey, getCurrentUser } from "../auth/api/session";
import { ActiveShopRoute } from "./ActiveShopRoute";
import { activeShopKey } from "./active-shop";
import { getShopMembership } from "./api/context";
import { NavigationProtection } from "../../app/router/NavigationProtection";
import { useDraftGuard } from "../../app/router/useDraftGuard";

vi.mock("../auth/api/session", async (original) => ({
  ...(await original<typeof import("../auth/api/session")>()),
  getCurrentUser: vi.fn(),
}));
vi.mock("./api/context", () => ({ getShopMembership: vi.fn() }));
const membership: UserMembership = {
  id: "m",
  shopId: "shop-a",
  role: "OWNER",
  shop: { id: "shop-a", name: "Cafe", slug: "cafe", isActive: true },
};
const account: CurrentUserResponse = {
  user: {
    id: "user",
    email: "owner@example.com",
    firstName: null,
    lastName: null,
    createdAt: "2026-10-26T00:00:00Z",
    memberships: [membership],
  },
};
function Draft() {
  useDraftGuard(true);
  return (
    <label>
      Private settings draft
      <input defaultValue="Unsaved change" />
    </label>
  );
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(account);
  vi.mocked(getShopMembership).mockResolvedValue(membership);
});
it.each(["role", "membership", "session"] as const)(
  "a revoked %s closes a dirty protected page without a draft blocker",
  async (revoked) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(currentUserKey, account);
    client.setQueryData(["private-record", "shop-a"], { sensitive: true });
    const router = createMemoryRouter(
      [
        {
          element: (
            <NavigationProtection>
              <Outlet />
            </NavigationProtection>
          ),
          children: [
            {
              path: "/app",
              element: (
                <ProtectedRoute>
                  <Outlet />
                </ProtectedRoute>
              ),
              children: [
                {
                  path: "shops/:shopId",
                  element: <ActiveShopRoute />,
                  children: [
                    { index: true, element: <h1>Allowed overview</h1> },
                    { path: "settings", element: <Draft /> },
                  ],
                },
                { path: "account", element: <h1>Your account</h1> },
              ],
            },
            { path: "/login", element: <h1>Sign in</h1> },
          ],
        },
      ],
      { initialEntries: ["/app/shops/shop-a/settings"] },
    );
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByLabelText("Private settings draft");
    if (revoked === "role")
      vi.mocked(getShopMembership).mockResolvedValue({
        ...membership,
        role: "MANAGER",
      });
    if (revoked === "membership")
      vi.mocked(getShopMembership).mockRejectedValue(failure(404));
    if (revoked === "session")
      vi.mocked(getCurrentUser).mockRejectedValue(failure(401));
    await act(async () => {
      await client.invalidateQueries({
        queryKey:
          revoked === "session"
            ? currentUserKey
            : activeShopKey("user", "shop-a"),
      });
    });
    await screen.findByRole("heading", {
      name:
        revoked === "role"
          ? "Allowed overview"
          : revoked === "membership"
            ? "Your account"
            : "Sign in",
    });
    expect(
      screen.queryByRole("dialog", { name: "Leave this page?" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Private settings draft"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(client.getQueryData(["private-record", "shop-a"])).toBeUndefined(),
    );
  },
);
