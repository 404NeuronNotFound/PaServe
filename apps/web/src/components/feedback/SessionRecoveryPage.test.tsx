import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SessionRecoveryPage } from "./SessionRecoveryPage";

afterEach(cleanup);

it("focuses the recovery heading, explains the uncertain session and retries on request", async () => {
  const retry = vi.fn();
  render(<MemoryRouter><SessionRecoveryPage title="Unable to restore your session" onRetry={retry} /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "Unable to restore your session" })).toHaveFocus();
  expect(document.title).toBe("Unable to restore your session · PaServe");
  expect(screen.getByText(/Your session may still be valid/)).toBeVisible();
  expect(screen.getByRole("switch", { name: "Dark appearance" })).toBeInTheDocument();
  expect(retry).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it("locks repeated retries while a session check is in progress", async () => {
  const retry = vi.fn();
  render(<MemoryRouter><SessionRecoveryPage title="Unable to check your session" onRetry={retry} pending /></MemoryRouter>);
  const button = screen.getByRole("button", { name: "Checking…" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Checking your session…")).toHaveAttribute("role", "status");
  await userEvent.setup().click(button);
  expect(retry).not.toHaveBeenCalled();
});
