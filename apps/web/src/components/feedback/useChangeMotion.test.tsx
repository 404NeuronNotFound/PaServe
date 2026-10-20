import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChangeMotion } from "./useChangeMotion";

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
let preference: EventTarget & { matches: boolean };
beforeEach(() => {
  preference = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", vi.fn(() => preference));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});
function Harness({ value, kind = "count" }: { value: string | number; kind?: "count" | "price" | "queue" }) {
  const ref = useChangeMotion<HTMLSpanElement>(value, kind);
  return <><button>Keep working</button><span ref={ref}>{value}</span></>;
}
it.each(["count", "price", "queue"] as const)("cues a %s change once without replaying unchanged data or moving focus", (kind) => {
  const view = (value: number) => <StrictMode><Harness value={value} kind={kind} /></StrictMode>;
  const { rerender } = render(view(1));
  expect(animate).not.toHaveBeenCalled();
  const button = screen.getByRole("button");
  button.focus();
  rerender(view(2));
  expect(screen.getByText("2")).toBeVisible();
  expect(animate).toHaveBeenCalledTimes(1);
  expect(button).toHaveFocus();
  rerender(view(2));
  expect(animate).toHaveBeenCalledTimes(1);
  rerender(view(3));
  expect(cancel).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenCalledTimes(2);
});
it("shows new values instantly with reduced motion and cancels a running cue when the preference changes", () => {
  const { rerender, unmount } = render(<Harness value={1} />);
  rerender(<Harness value={2} />);
  act(() => {
    preference.matches = true;
    preference.dispatchEvent(new Event("change"));
  });
  expect(cancel).toHaveBeenCalledOnce();
  rerender(<Harness value={3} />);
  expect(screen.getByText("3")).toBeVisible();
  expect(animate).toHaveBeenCalledTimes(1);
  unmount();
  const calls = cancel.mock.calls.length;
  act(() => preference.dispatchEvent(new Event("change")));
  expect(cancel).toHaveBeenCalledTimes(calls);
});
it("cancels hidden-tab motion and skips background changes without replaying on return", () => {
  const hidden = vi.spyOn(document, "hidden", "get");
  const { rerender, unmount } = render(<Harness value={1} />);
  rerender(<Harness value={2} />);
  act(() => {
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(cancel).toHaveBeenCalledOnce();
  rerender(<Harness value={3} />);
  hidden.mockReturnValue(false);
  rerender(<Harness value={3} />);
  expect(animate).toHaveBeenCalledTimes(1);
  unmount();
});
it("keeps state usable when the animation API is unavailable or rejects a cue", () => {
  animate.mockImplementationOnce(() => { throw new Error("Unsupported animation"); });
  const { rerender } = render(<Harness value={1} />);
  rerender(<Harness value={2} />);
  expect(screen.getByText("2")).toBeVisible();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  rerender(<Harness value={3} />);
  expect(screen.getByText("3")).toBeVisible();
  expect(screen.getByRole("button")).toBeEnabled();
});
