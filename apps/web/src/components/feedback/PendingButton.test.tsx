import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi, describe, beforeEach } from "vitest";
import { PendingButton } from "./PendingButton";
import { pendingActionLabel } from "./pending-action-label";

describe.each(["day", "night"] as const)("%s appearance", (appearance) => {

afterEach(cleanup);

it("keeps one native button, exposes pending progress and blocks repeat activation", () => {
  const click = vi.fn();
  const view = (pending: boolean) => (
    <PendingButton
      type="button"
      pending={pending}
      pendingLabel="Saving product…"
      onClick={click}
    >
      Save product
    </PendingButton>
  );
  const { rerender } = render(view(false));
  const button = screen.getByRole("button", { name: "Save product" });
  fireEvent.click(button);
  rerender(view(true));
  expect(screen.getByRole("button", { name: "Saving product…" })).toBe(button);
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(1);
  rerender(view(false));
  expect(screen.getByRole("button", { name: "Save product" })).toBeEnabled();
  expect(button).toHaveAttribute("type", "button");
});

it("retains external disabled locks when a request ends", () => {
  const { rerender } = render(
    <PendingButton disabled pending pendingLabel="Saving…">
      Save
    </PendingButton>,
  );
  rerender(
    <PendingButton disabled pending={false} pendingLabel="Saving…">
      Save
    </PendingButton>,
  );
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("announces an icon action without exposing decorative spinner content", () => {
  render(
    <PendingButton iconOnly pending pendingLabel="Refreshing products…">
      <span className="sr-only">Refresh products</span>
    </PendingButton>,
  );
  expect(
    screen.getByRole("button", { name: "Refreshing products…" }),
  ).toBeDisabled();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it.each([
  ["Delete category", "Deleting category…"],
  ["Archive product", "Archiving product…"],
  ["Undo", "Undoing…"],
])("keeps the action context of %s", (label, expected) => {
  expect(pendingActionLabel(label)).toBe(expected);
});

  beforeEach(() => { document.documentElement.dataset.appearance = appearance; });
  afterEach(() => { delete document.documentElement.dataset.appearance; });
});
