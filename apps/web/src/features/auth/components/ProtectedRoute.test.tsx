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
function renderRoute() {
  render(
    <MemoryRouter initialEntries={["/app/account"]}>
      <QueryClientProvider client={new QueryClient()}>
        <Routes>
          <Route
            path="/app/account"
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
  expect(await screen.findByText("Private account")).toBeInTheDocument();
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
