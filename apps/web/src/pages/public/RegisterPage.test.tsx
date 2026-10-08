import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegisterPage } from "./RegisterPage";
import { registerAccount } from "../../features/auth/api/register";

vi.mock("../../features/auth/api/register", () => ({
  registerAccount: vi.fn(),
}));

it("moves keyboard focus to the success heading after account creation", async () => {
  vi.mocked(registerAccount).mockResolvedValue({
    user: {
      id: "user-id",
      email: "owner@example.com",
      createdAt: "2026-10-08T00:00:00.000Z",
    },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <RegisterPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), "owner@example.com");
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "a long test passphrase",
  );
  await user.type(
    screen.getByLabelText("Confirm password"),
    "a long test passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(
    await screen.findByRole("heading", { name: "Account created." }),
  ).toHaveFocus();
  expect(
    screen.queryByLabelText("Password", { exact: true }),
  ).not.toBeInTheDocument();
});
