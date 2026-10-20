import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomizationEditor } from "./CustomizationEditor";

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

it.each([
  ["Name", "", /Enter a name/, "Oat Milk"],
  ["Extra charge (PHP)", "invalid", /Enter an extra charge/, "15.00"],
  ["List position", "-1", /List position must/, "2"],
] as const)("associates %s validation and focuses the field without losing the draft", async (label, invalid, message, corrected) => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<CustomizationEditor kind="addon" busy={false} blocked={false} error="" onSave={onSave} onClose={vi.fn()} />);
  const name = screen.getByLabelText("Name");
  expect(name).toHaveFocus();
  if (label !== "Name") await user.type(name, "Oat Milk");
  if (label === "List position") await user.click(screen.getByText("More settings"));
  const field = screen.getByLabelText(label);
  await user.clear(field);
  if (invalid) await user.type(field, invalid);
  if (label === "List position") await user.click(screen.getByText("More settings"));
  await user.click(screen.getByRole("button", { name: "Create add-on" }));
  expect(field).toHaveFocus();
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription(message);
  expect(onSave).not.toHaveBeenCalled();
  if (label !== "Name") expect(name).toHaveValue("Oat Milk");
  await user.clear(field);
  await user.type(field, corrected);
  expect(field).toHaveAttribute("aria-invalid", "false");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create add-on" }));
  expect(onSave).toHaveBeenCalledOnce();
});
