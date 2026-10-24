import { afterEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../../lib/api/client";
import {
  currentUserKey,
  logoutAccount,
  refreshSession,
} from "../../features/auth/api/session";
import { useSessionStore } from "../../features/auth/stores/session";
import { AccountPage } from "./AccountPage";
import { ProfilePage } from "./ProfilePage";
import { PlacesPage } from "./PlacesPage";

afterEach(() => {
  vi.restoreAllMocks();
  useSessionStore.getState().setAccessToken(null);
  localStorage.removeItem("paserve.sidebar.collapsed");
});

it("clears the access token and private cache and navigates to login after logout", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({ status: 204 });
  useSessionStore.getState().setAccessToken("access-token");
  const client = new QueryClient();
  client.setQueryData(currentUserKey, { user: { email: "owner@example.com" } });
  client.setQueryData(["private-data"], { secret: "cached data" });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/account"]}>
        <Routes>
          <Route path="/app/account" element={<AccountPage />} />
          <Route path="/login" element={<h1>Sign in</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Sign out" }));
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  expect(post).toHaveBeenCalledWith(
    "/auth/logout",
    {},
    {
      headers: { "X-PaServe-Client": "web" },
      timeout: 15_000,
    },
  );
  expect(useSessionStore.getState().accessToken).toBeNull();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it("finishes an in-flight refresh before logout and blocks further refresh attempts", async () => {
  let completeRefresh!: (value: unknown) => void;
  let completeLogout!: (value: unknown) => void;
  const post = vi
    .spyOn(api, "post")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeRefresh = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeLogout = resolve;
        }),
    );
  const refreshing = refreshSession();
  const loggingOut = logoutAccount();
  await expect(refreshSession()).rejects.toThrow("Sign-out is in progress.");
  expect(post).toHaveBeenCalledTimes(1);
  completeRefresh({ data: { accessToken: "rotated-access-token" } });
  await refreshing;
  // Allow the logout continuation to submit its request.
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1][0]).toBe("/auth/logout");
  completeLogout({ status: 204 });
  await loggingOut;
  expect(useSessionStore.getState().accessToken).toBeNull();
});

it("offers one Create shop action and tracks the selected account section", async () => {
  const client = new QueryClient();
  client.setQueryData(currentUserKey, {
    user: { id: "u", email: "owner@example.com", firstName: null, lastName: null, createdAt: "2026-10-08T00:00:00Z", memberships: [] },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/account"]}>
        <Routes>
          <Route path="/app/account" element={<AccountPage />} />
          <Route path="/app/account/profile" element={<ProfilePage />} />
          <Route path="/app/account/places" element={<PlacesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getAllByRole("link", { name: "Create shop" })).toHaveLength(1);
  expect(
    screen.queryByRole("link", { name: /Add a new shop/i }),
  ).not.toBeInTheDocument();
  const navigation = within(screen.getByRole("navigation", { name: "Account navigation" }));
  const overview = navigation.getByRole("link", { name: "Overview" });
  const profile = navigation.getByRole("link", { name: "Your profile" });
  const places = navigation.getByRole("link", { name: "Your places" });
  expect(overview).toHaveAttribute("aria-current", "page");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(localStorage.getItem("paserve.sidebar.collapsed")).toBe("true");
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
  await user.click(profile);
  expect(screen.getByRole("link", { name: "Your profile" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { name: "Your profile" })).toHaveFocus();
  expect(places).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Your places" }));
  expect(screen.getByRole("link", { name: "Your places" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { name: "Your places" })).toHaveFocus();
});
