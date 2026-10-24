import { afterEach, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSync } from "./SessionSync";
import { useSessionStore } from "../stores/session";
import { useDraftGuard } from "../../../app/router/useDraftGuard";
import { NavigationProtection } from "../../../app/router/NavigationProtection";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

afterEach(() => {
  useSessionStore.setState({ accessToken: null, signedOutElsewhere: false });
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});
function PrivateDraft() {
  useDraftGuard(true);
  return <h1>Private draft</h1>;
}
it("clears private caches and unmounts a protected draft without a leave-page dialog", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  window.history.replaceState(null, "", "/app/account");
  const client = new QueryClient();
  client.setQueryData(["auth", "me"], { user: { id: "user" } });
  client.setQueryData(["private", "orders"], { secret: "private" });
  useSessionStore.getState().setAccessToken("access-token");
  const router = createMemoryRouter(
    [
      {
        path: "/app/account",
        element: (
          <NavigationProtection>
            <PrivateDraft />
          </NavigationProtection>
        ),
      },
    ],
    { initialEntries: ["/app/account"] },
  );
  render(
    <QueryClientProvider client={client}>
      <SessionSync>
        <RouterProvider router={router} />
      </SessionSync>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Private draft")).toBeVisible();
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "paserve.auth.signed-out",
        newValue: JSON.stringify({ type: "signed-out", id: "remote-logout" }),
      }),
    ),
  );
  expect(
    await screen.findByRole("heading", { name: "You’ve been signed out" }),
  ).toBeVisible();
  expect(screen.queryByText("Private draft")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(useSessionStore.getState().accessToken).toBeNull();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
