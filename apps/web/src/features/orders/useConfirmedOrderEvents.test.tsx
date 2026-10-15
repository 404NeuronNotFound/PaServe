import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useConfirmedOrderEvents } from "./useConfirmedOrderEvents";
import { subscribeOrderStream } from "./new-order-events";

vi.mock("./new-order-events", () => ({
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));
beforeEach(() => vi.clearAllMocks());
it("ignores unrelated orders and defers confirmation during an in-flight staff action", () => {
  const refresh = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ busy }) => useConfirmedOrderEvents("shop-a", "order-a", refresh, busy),
    { initialProps: { busy: true } },
  );
  const notify = vi.mocked(subscribeOrderStream).mock.calls[0][4];
  act(() => notify("order_confirmed", { orderId: "order-b" }));
  expect(refresh).not.toHaveBeenCalled();
  act(() => notify("order_confirmed", { orderId: "order-a" }));
  expect(refresh).not.toHaveBeenCalled();
  rerender({ busy: false });
  expect(refresh).toHaveBeenCalledOnce();
  act(() => notify("resync", {}));
  expect(refresh).toHaveBeenCalledTimes(2);
  unmount();
});
