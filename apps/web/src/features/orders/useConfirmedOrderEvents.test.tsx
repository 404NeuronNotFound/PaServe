import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConfirmedOrderEvents } from "./useConfirmedOrderEvents";
import { subscribeOrderStream } from "./new-order-events";

vi.mock("./new-order-events", () => ({
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
it.each(["order_confirmed", "order_completed"] as const)(
  "ignores unrelated orders and defers %s during an in-flight staff action",
  (event) => {
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ busy }) => useConfirmedOrderEvents("shop-a", "order-a", refresh, busy),
      { initialProps: { busy: true } },
    );
    const notify = vi.mocked(subscribeOrderStream).mock.calls[0][4];
    act(() => notify(event, { orderId: "order-b" }));
    expect(refresh).not.toHaveBeenCalled();
    act(() => notify(event, { orderId: "order-a" }));
    expect(refresh).not.toHaveBeenCalled();
    rerender({ busy: false });
    expect(refresh).toHaveBeenCalledOnce();
    act(() => notify("resync", {}));
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
  },
);

it("recovers an open cashier receipt through polling, focus and online events while realtime is down", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const { unmount } = renderHook(() =>
    useConfirmedOrderEvents("shop-a", "order-a", refresh),
  );
  act(() => vi.mocked(subscribeOrderStream).mock.calls[0][5]("retrying"));
  act(() => vi.advanceTimersByTime(15_000));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event("focus")));
  act(() => window.dispatchEvent(new Event("online")));
  expect(refresh).toHaveBeenCalledTimes(3);
  unmount();
  act(() => {
    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event("focus"));
  });
  expect(refresh).toHaveBeenCalledTimes(3);
});

it("coalesces recovery while a staff action is busy and drops deferred work when the order changes", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ order, busy }) =>
      useConfirmedOrderEvents("shop-a", order, refresh, busy),
    { initialProps: { order: "order-a", busy: true } },
  );
  const oldNotify = vi.mocked(subscribeOrderStream).mock.calls[0][4];
  act(() => {
    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event("online"));
  });
  expect(refresh).not.toHaveBeenCalled();
  rerender({ order: "order-a", busy: false });
  expect(refresh).toHaveBeenCalledTimes(1);
  rerender({ order: "order-a", busy: true });
  act(() => vi.advanceTimersByTime(15_000));
  rerender({ order: "order-b", busy: false });
  act(() => oldNotify("order_completed", { orderId: "order-a" }));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(15_000));
  expect(refresh).toHaveBeenCalledTimes(2);
  unmount();
});
