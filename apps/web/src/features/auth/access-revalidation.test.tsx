import { afterEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ACCESS_FRESH_MS, useRecentAccess } from "./access-revalidation";

afterEach(() => vi.useRealTimers());
it("expires the recent verification without waiting for another network response", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  const checkedAt = Date.now();
  const { result } = renderHook(() => useRecentAccess(checkedAt));
  expect(result.current).toBe(true);
  act(() => vi.advanceTimersByTime(ACCESS_FRESH_MS));
  expect(result.current).toBe(false);
});
it("renews freshness only with a newer successful server result", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  const { result, rerender } = renderHook(({ at }) => useRecentAccess(at), {
    initialProps: { at: Date.now() },
  });
  act(() => vi.advanceTimersByTime(ACCESS_FRESH_MS));
  expect(result.current).toBe(false);
  rerender({ at: Date.now() });
  expect(result.current).toBe(true);
  act(() => vi.advanceTimersByTime(ACCESS_FRESH_MS));
  expect(result.current).toBe(false);
});
it("does not treat an absent or old timestamp as a fresh verification", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  const { result, rerender } = renderHook(({ at }) => useRecentAccess(at), {
    initialProps: { at: 0 },
  });
  expect(result.current).toBe(false);
  rerender({ at: Date.now() - ACCESS_FRESH_MS - 1 });
  act(() => vi.advanceTimersByTime(0));
  expect(result.current).toBe(false);
});
