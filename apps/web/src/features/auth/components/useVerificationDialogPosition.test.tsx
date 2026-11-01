import { useRef } from "react";
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useVerificationDialogPosition } from "./useVerificationDialogPosition";

let formLeft = 980;
function Harness() {
  const form = useRef<HTMLFormElement>(null);
  const modal = useVerificationDialogPosition(true, form);
  return (
    <section className="form-panel">
      <form ref={form} />
      <Dialog open>
        <DialogContent ref={modal}>
          <DialogTitle>Verify your email</DialogTitle>
          <DialogDescription>Enter your code.</DialogDescription>
        </DialogContent>
      </Dialog>
    </section>
  );
}
beforeEach(() => {
  formLeft = 980;
  vi.stubGlobal("innerWidth", 1600);
  vi.stubGlobal("ResizeObserver", undefined);
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.tagName === "FORM")
        return { left: formLeft, width: 480 } as DOMRect;
      if (this.classList.contains("form-panel"))
        return { left: 860, width: 720 } as DOMRect;
      return original.call(this);
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("centers the portalled modal over the actual form column and follows resizing", async () => {
  render(<Harness />);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(dialog.style.getPropertyValue("--verification-dialog-left")).toBe(
      "1220px",
    ),
  );
  expect(dialog.style.getPropertyValue("--verification-dialog-width")).toBe(
    "480px",
  );
  formLeft = 900;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(dialog.style.getPropertyValue("--verification-dialog-left")).toBe(
    "1140px",
  );
});
it("returns to viewport centering at the mobile breakpoint", async () => {
  render(<Harness />);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(dialog.style.getPropertyValue("--verification-dialog-left")).toBe(
      "1220px",
    ),
  );
  vi.stubGlobal("innerWidth", 375);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(dialog.style.getPropertyValue("--verification-dialog-left")).toBe("");
  expect(dialog.style.getPropertyValue("--verification-dialog-width")).toBe("");
});
