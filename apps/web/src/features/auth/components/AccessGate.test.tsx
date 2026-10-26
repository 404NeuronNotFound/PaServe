import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AccessGate } from "./AccessGate";

const mounted = vi.fn();
function Workspace() {
  const [amount, setAmount] = useState("");
  useEffect(() => {
    mounted();
  }, []);
  return (
    <>
      <label>
        Amount
        <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {createPortal(
        <dialog open className="payment-dialog">
          Payment confirmation
        </dialog>,
        document.body,
      )}
    </>
  );
}
const gate = (allowed: boolean, pending = false) => (
  <AccessGate
    allowed={allowed}
    pending={pending}
    label="Checking access"
    fallback={<button>Try again</button>}
  >
    <Workspace />
  </AccessGate>
);
it("does not mount protected tools before their initial validation", () => {
  mounted.mockClear();
  render(gate(false, true));
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
  expect(mounted).not.toHaveBeenCalled();
});
it("locks content and portals without remounting or losing inputs or focus", async () => {
  mounted.mockClear();
  const { rerender } = render(gate(true));
  const amount = screen.getByLabelText("Amount");
  fireEvent.change(amount, { target: { value: "200" } });
  act(() => amount.focus());
  rerender(gate(false, true));
  expect(amount).not.toBeVisible();
  expect(amount.closest("[inert]")).not.toBeNull();
  const lock = screen.getByRole("dialog", { name: "Checking access" });
  expect(lock).toHaveAttribute("aria-modal", "true");
  expect(lock).toHaveAttribute("open");
  expect(document.querySelector(".payment-dialog")).toHaveAttribute("open");
  expect(
    fireEvent(lock, new Event("cancel", { bubbles: true, cancelable: true })),
  ).toBe(false);
  expect(lock).toHaveAttribute("open");
  rerender(gate(true));
  expect(screen.getByLabelText("Amount")).toBe(amount);
  expect(amount).toHaveValue("200");
  expect(amount).toBeVisible();
  expect(mounted).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(amount).toHaveFocus());
});
it("keeps a transient failure locked until a successful retry", () => {
  const { rerender } = render(gate(true));
  const amount = screen.getByLabelText("Amount");
  fireEvent.change(amount, { target: { value: "500" } });
  rerender(gate(false));
  expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(amount).not.toBeVisible();
  rerender(gate(true));
  expect(amount).toHaveValue("500");
  expect(amount).toBeVisible();
});
