import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVisibleNow } from "./useVisibleNow";

let visibility = "visible";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("pauses hidden-page updates and catches up from wall time on return", () => {
  const { result } = renderHook(() => useVisibleNow());
  act(() => vi.advanceTimersByTime(30_000));
  const lastVisible = result.current;
  visibility = "hidden";
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => vi.advanceTimersByTime(5 * 60_000));
  expect(result.current).toBe(lastVisible);
  visibility = "visible";
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current).toBe(Date.now());
  expect(result.current - lastVisible).toBe(5 * 60_000);
});
it("does not update an inactive view and catches up when re-enabled", () => {
  const { result, rerender } = renderHook(({ enabled }) => useVisibleNow(enabled), { initialProps: { enabled: false } });
  const initial = result.current;
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current).toBe(initial);
  rerender({ enabled: true });
  act(() => vi.advanceTimersByTime(0));
  expect(result.current).toBe(Date.now());
  rerender({ enabled: false });
  const paused = result.current;
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current).toBe(paused);
});
it("releases timers on unmount and starts no interval while initially hidden", () => {
  visibility = "hidden";
  const { unmount } = renderHook(() => useVisibleNow());
  act(() => vi.advanceTimersByTime(0));
  expect(vi.getTimerCount()).toBe(0);
  visibility = "visible";
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(0);
});
