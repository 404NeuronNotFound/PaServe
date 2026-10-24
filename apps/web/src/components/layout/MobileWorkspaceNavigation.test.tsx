import { afterEach, beforeEach, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileWorkspaceNavigation } from "./MobileWorkspaceNavigation";

const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => {
  if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});
function Sheet() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Navigation</button><MobileWorkspaceNavigation open={open} onClose={() => setOpen(false)} shopName="Cafe A"><a href="/app/shops/a/orders">Orders</a></MobileWorkspaceNavigation></>;
}
it("opens a named modal and supports explicit close and native Escape dismissal", async () => {
  const user = userEvent.setup(); render(<Sheet />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Navigation" }));
  expect(screen.getByRole("dialog", { name: "Explore your shop" })).toBeVisible();
  expect(screen.getByText("Cafe A")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close navigation" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Navigation" }));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("dismisses the backdrop without dismissing clicks inside navigation content", async () => {
  const user = userEvent.setup(); render(<Sheet />);
  await user.click(screen.getByRole("button", { name: "Navigation" }));
  await user.click(screen.getByText("Cafe A"));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
