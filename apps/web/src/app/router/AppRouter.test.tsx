import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { AppRouter } from "./AppRouter";
import { getCurrentUser } from "../../features/auth/api/session";

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
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

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
  "/app/shops/05bcdf9f-d1be-4669-a01c-0b657f5a2f8e/menu-preview",
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
