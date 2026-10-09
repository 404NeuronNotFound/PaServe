import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DecisionDialog } from "./DecisionDialog";

const modalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeEach(() => {
  // jsdom has no native modal layer. Browser focus trapping uses showModal().
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (modalDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      modalDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (closeDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      closeDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function Harness({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Delete record</button>
      <DecisionDialog
        open={open}
        title="Delete this record?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

it("requires an explicit decision and focuses Cancel before a destructive action", async () => {
  const action = vi.fn();
  const user = userEvent.setup();
  render(<Harness onConfirm={action} />);
  await user.click(screen.getByRole("button", { name: "Delete record" }));
  expect(
    screen.getByRole("dialog", { name: "Delete this record?" }),
  ).toHaveAttribute("aria-modal", "true");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(action).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete record" })).toHaveFocus();
  expect(action).not.toHaveBeenCalled();
});

it("closes on Escape without executing the action", async () => {
  const action = vi.fn();
  render(<Harness onConfirm={action} />);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Delete record" }));
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
});

it("blocks repeat confirmation and dismissal while the action is pending", async () => {
  let resolve!: () => void;
  const action = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const user = userEvent.setup();
  render(<Harness onConfirm={action} />);
  await user.click(screen.getByRole("button", { name: "Delete record" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete record" })).toHaveFocus();
});

it("keeps action errors inside the dialog and lets the user retry", async () => {
  const action = vi
    .fn()
    .mockRejectedValueOnce(new Error("Sensitive details"))
    .mockResolvedValueOnce(undefined);
  const user = userEvent.setup();
  render(<Harness onConfirm={action} />);
  await user.click(screen.getByRole("button", { name: "Delete record" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The action could not be completed.",
  );
  expect(screen.queryByText("Sensitive details")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps an animated dismissal blocked until it finishes and then restores focus", () => {
  vi.useFakeTimers();
  try {
    const action = vi.fn();
    function AnimatedHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Delete record</button>
          <DecisionDialog
            open={open}
            title="Delete record?"
            description="Your products are kept."
            confirmLabel="Delete"
            animateClose
            destructive
            onConfirm={action}
            onClose={() => setOpen(false)}
          />
        </>
      );
    }
    render(<AnimatedHarness />);
    const trigger = screen.getByRole("button", { name: "Delete record" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    act(() => vi.advanceTimersByTime(179));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(action).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
