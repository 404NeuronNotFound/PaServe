import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";
import { statusPresentation } from "./status-presentation";
import { readFileSync } from "node:fs";
const theme = readFileSync("src/theme.css", "utf8");

afterEach(cleanup);

it.each([
  ["warning", ["PENDING_CONFIRMATION", "UNPAID", "QUEUED", "PENDING"]],
  ["info", ["PREPARING"]],
  ["success", ["CONFIRMED", "PAID", "READY", "COMPLETED", "AVAILABLE", "VISIBLE", "ENABLED", "ACCEPTED"]],
  ["neutral", ["NOT_STARTED", "SOLD_OUT", "UNAVAILABLE", "HIDDEN", "ARCHIVED", "DISABLED", "INACTIVE", "EXPIRED", "REVOKED"]],
  ["danger", ["REJECTED", "CANCELLED", "FAILED"]],
] as const)("gives %s states visible labels and decorative icons", (tone, states) => {
  for (const state of states) {
    const { unmount } = render(<StatusBadge state={state} />);
    const badge = screen.getByText(statusPresentation(state).label);
    expect(badge).toBeVisible();
    expect(badge).toHaveAttribute("data-tone", tone);
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
  }
});
it("fails neutral for unknown statuses and preserves contextual labels", () => {
  render(<><StatusBadge state="__proto__" /><StatusBadge state="READY">Ready for pickup</StatusBadge></>);
  expect(screen.getByText("Unknown status")).toHaveAttribute("data-tone", "neutral");
  expect(screen.getByText("Ready for pickup")).toHaveAttribute("data-tone", "success");
});

function luminance(hex: string) {
  const channels = hex.match(/[0-9a-f]{2}/gi)!.map((value) => {
    const s = parseInt(value, 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
it.each(["day", "night"])("keeps status text contrast at least 4.5:1 in %s appearance", (appearance) => {
  const block = appearance === "day" ? theme.match(/:root\s*\{([^}]+)\}/)![1]
    : theme.match(/:root\[data-appearance="night"\]\s*\{([^}]+)\}/)![1];
  const token = (name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))![1];
  for (const [text, background] of [
    ["status-success-text", "status-success-surface"],
    ["status-warning-text", "status-warning-surface"],
    ["status-info-text", "status-info-surface"],
    ["color-error", "color-error-surface"],
    ["color-text", "color-secondary"],
  ]) {
    const a = luminance(token(text)), b = luminance(token(background));
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
