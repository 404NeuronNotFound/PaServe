import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { ProtectedRoute } from "./ProtectedRoute";
import { getCurrentUser } from "../api/session";

vi.mock("../api/session", () => ({
  currentUserKey: ["auth", "me"],
  getCurrentUser: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
});
function renderRoute(client = new QueryClient(), path = "/app/account") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route
            path={path}
            element={
              <ProtectedRoute>
                <h1>Private account</h1>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<h1>Sign in</h1>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it("renders the protected page only after the server verifies the session", async () => {
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
  renderRoute();
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
  expect(document.querySelector('.loading-skeleton [aria-busy="true"]')).not.toBeNull();
  expect(await screen.findByText("Private account")).toBeInTheDocument();
  expect(document.querySelector(".loading-skeleton")).toBeNull();
});

it("redirects unauthenticated visitors to sign in", async () => {
  const error = new AxiosError("Unauthorized");
  error.response = {
    status: 401,
    statusText: "Unauthorized",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  };
  vi.mocked(getCurrentUser).mockRejectedValue(error);
  renderRoute();
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
});

it("shows a retry action for network failure instead of pretending the user signed out", async () => {
  vi.mocked(getCurrentUser).mockRejectedValue(new Error("network unavailable"));
  renderRoute();
  expect(
    await screen.findByRole("button", { name: "Try again" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
});

it("does not expose a private page from a cached profile while rechecking a revoked session", async () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "me"], { user: { id: "previous-user" } });
  vi.mocked(getCurrentUser).mockRejectedValue(
    new Error("session check failed"),
  );
  renderRoute(client, "/app/shops/shop-a/cashier");
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
  expect(document.querySelector(".loading-skeleton .skeleton-access-camera")).not.toBeNull();
  expect(
    await screen.findByRole("button", { name: "Try again" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
});
