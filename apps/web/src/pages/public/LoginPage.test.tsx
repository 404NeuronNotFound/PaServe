import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { LoginResponse } from "@paserve/contracts";
import { LoginPage } from "./LoginPage";

vi.mock("../../components/layout/AuthLayout", () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("../../features/auth/components/LoginForm", () => ({
  LoginForm: ({
    onSuccess,
  }: {
    onSuccess: (session: LoginResponse) => void;
  }) => (
    <button
      onClick={() =>
        onSuccess({
          user: { id: "u", email: "u@example.com", createdAt: "2026-10-09" },
          accessToken: "token",
          tokenType: "Bearer",
          expiresIn: 900,
        })
      }
    >
      Sign in
    </button>
  ),
}));

it("enters active-shop resolution after login with a clean private cache", async () => {
  const client = new QueryClient();
  client.setQueryData(["shops", "previous-user"], { secret: true });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app" element={<h1>Resolve shop</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByRole("heading", { name: "Resolve shop" }),
  ).toBeInTheDocument();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
