import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PasswordRecoveryForm } from "./PasswordRecoveryForm";
import {
  requestPasswordRecovery,
  resetRecoveredPassword,
} from "../api/password-recovery";

vi.mock("../api/password-recovery", () => ({
  requestPasswordRecovery: vi.fn(),
  resetRecoveredPassword: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requestPasswordRecovery).mockResolvedValue({
    message:
      "If this email has a password account, check your inbox for a reset code.",
  });
  vi.mocked(resetRecoveredPassword).mockResolvedValue({
    message: "Your password has been reset.",
  });
});
afterEach(cleanup);

it("requests recovery, confirms a new password, and clears the sensitive form on success", async () => {
  const user = userEvent.setup();
  render(<PasswordRecoveryForm />);
  await user.type(screen.getByLabelText("Email address"), "Owner@Example.com");
  await user.click(screen.getByRole("button", { name: "Send reset code" }));
  expect(requestPasswordRecovery).toHaveBeenCalledWith(
    "owner@example.com",
    undefined,
  );
  expect(
    screen.getByRole("button", { name: "Resend code in 60s" }),
  ).toBeDisabled();
  await user.type(screen.getByLabelText("Email reset code"), "123456");
  await user.type(screen.getByLabelText("New password"), "new long passphrase");
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "new long passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Reset password" }));
  expect(resetRecoveredPassword).toHaveBeenCalledWith({
    email: "owner@example.com",
    code: "123456",
    password: "new long passphrase",
  });
  expect(
    screen.getByRole("link", { name: "Sign in with new password" }),
  ).toHaveAttribute("href", "/login");
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
});
it("rejects mismatched passwords locally and provides independent eye controls", async () => {
  const user = userEvent.setup();
  render(<PasswordRecoveryForm />);
  await user.type(screen.getByLabelText("Email address"), "owner@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset code" }));
  await user.type(screen.getByLabelText("Email reset code"), "123456");
  await user.type(screen.getByLabelText("New password"), "new long passphrase");
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "another long passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Show new password" }));
  expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");
  expect(screen.getByLabelText("Confirm new password")).toHaveAttribute(
    "type",
    "password",
  );
  await user.click(screen.getByRole("button", { name: "Reset password" }));
  expect(screen.getByRole("alert")).toHaveTextContent("do not match");
  expect(resetRecoveredPassword).not.toHaveBeenCalled();
});
