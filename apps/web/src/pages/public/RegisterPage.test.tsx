import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegisterPage } from "./RegisterPage";
import {
  registerAccount,
  requestEmailCode,
} from "../../features/auth/api/register";
import { REGISTRATION_ACKNOWLEDGEMENT } from "@paserve/contracts";

vi.mock("../../features/auth/api/register", () => ({
  registerAccount: vi.fn(),
  requestEmailCode: vi.fn(),
}));

it("moves keyboard focus to the success heading after account creation", async () => {
  vi.mocked(registerAccount).mockResolvedValue({
    message: REGISTRATION_ACKNOWLEDGEMENT,
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <RegisterPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  vi.mocked(requestEmailCode).mockResolvedValue({
    message: "Check your inbox.",
  });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("First name"), "Ada");
  await user.type(screen.getByLabelText("Last name"), "Lovelace");
  await user.type(screen.getByLabelText("Email address"), "owner@example.com");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "a long test passphrase",
  );
  await user.type(
    screen.getByLabelText("Confirm password"),
    "a long test passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  for (const checkbox of screen.getAllByRole("checkbox"))
    await user.click(checkbox);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await user.type(
    await screen.findByLabelText("Email verification code"),
    "123456",
  );
  await user.click(
    screen.getByRole("button", { name: /verify email and create account/i }),
  );
  expect(
    await screen.findByRole("heading", { name: "Registration received." }),
  ).toHaveFocus();
  expect(
    screen.queryByLabelText("Password", { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(REGISTRATION_ACKNOWLEDGEMENT)).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Sign in to continue" }),
  ).toHaveAttribute("href", "/login");
  expect(
    screen.queryByText(/account is ready|account created|already exists/i),
  ).not.toBeInTheDocument();
});
