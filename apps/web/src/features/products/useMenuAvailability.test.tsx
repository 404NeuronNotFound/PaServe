import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeOrderStream } from "../orders/new-order-events";
import { useMenuAvailability } from "./useMenuAvailability";

const cache = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  invalidateQueries: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => cache }));
vi.mock("../orders/new-order-events", () => ({
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  cache.cancelQueries.mockResolvedValue(undefined);
  cache.invalidateQueries.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
};

it("serializes duplicate invalidations and rereads after an event during an in-flight refresh", async () => {
  let finish!: () => void;
  cache.invalidateQueries.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { unmount } = renderHook(() => useMenuAvailability("cafe"));
  const notify = vi.mocked(subscribeOrderStream).mock.calls[0][4];
  act(() => notify("product_sold_out", { shopSlug: "cafe" }));
  await flush();
  act(() => {
    for (let i = 0; i < 5; i++)
      notify("product_sold_out", { shopSlug: "cafe" });
  });
  expect(cache.invalidateQueries).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await flush();
  expect(cache.invalidateQueries).toHaveBeenCalledTimes(2);
  expect(cache.cancelQueries).toHaveBeenCalledTimes(2);
  expect(cache.invalidateQueries).toHaveBeenLastCalledWith({
    queryKey: ["public-menu", "cafe"],
  });
  unmount();
});

it("recovers through resync, focus, online, and polling, and cleans up on navigation", async () => {
  const { rerender, unmount } = renderHook(
    ({ slug }) => useMenuAvailability(slug),
    { initialProps: { slug: "cafe" } },
  );
  const notify = vi.mocked(subscribeOrderStream).mock.calls[0][4];
  act(() => notify("resync", { shopSlug: "cafe" }));
  await flush();
  act(() => window.dispatchEvent(new Event("focus")));
  await flush();
  act(() => window.dispatchEvent(new Event("online")));
  await flush();
  act(() => vi.advanceTimersByTime(15_000));
  await flush();
  expect(cache.invalidateQueries).toHaveBeenCalledTimes(4);
  rerender({ slug: "other" });
  expect(
    vi.mocked(subscribeOrderStream).mock.results[0].value,
  ).toHaveBeenCalledOnce();
  const oldReads = cache.invalidateQueries.mock.calls.length;
  unmount();
  act(() => {
    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event("online"));
  });
  await flush();
  expect(cache.invalidateQueries).toHaveBeenCalledTimes(oldReads);
  expect(
    vi.mocked(subscribeOrderStream).mock.results[1].value,
  ).toHaveBeenCalledOnce();
});
