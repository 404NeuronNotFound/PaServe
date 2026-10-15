import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCustomerConfirmation } from "./useCustomerConfirmation";
import { subscribeOrderStream } from "./new-order-events";

vi.mock("./new-order-events", () => ({
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));
vi.mock("../../lib/api/client", () => ({
  api: { defaults: { baseURL: "/api/v1" } },
}));
const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
const orderId = "e47f6994-a303-4a7b-87b0-2386d5198828";
const token = `${Buffer.from(JSON.stringify({ v: 1, purpose: "order-receipt", shopId, orderId, nonce: "75992537-5d60-4d22-8e1e-60a114644681", exp: Date.parse("2030-01-01T00:00:00Z") })).toString("base64url")}.${"a".repeat(43)}`;
const pending = {
  id: orderId,
  shopId,
  orderNumber: "ORD-000042",
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  confirmedAt: null,
  updatedAt: "2026-10-15T01:00:00Z",
};
const confirmed = {
  ...pending,
  status: "CONFIRMED",
  paymentStatus: "PAID",
  confirmedAt: "2026-10-15T01:01:00Z",
  updatedAt: "2026-10-15T01:01:00Z",
};
const response = (order: typeof pending | typeof confirmed) => ({
  ok: true,
  status: 200,
  json: async () => ({ order }),
});
const fetchStatus = vi.fn();
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchStatus);
  fetchStatus.mockResolvedValue(response(pending));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("fetches and renders confirmation immediately on the event without advancing the polling clock", async () => {
  const started = Date.now();
  const { result } = renderHook(() =>
    useCustomerConfirmation("cafe", orderId, token),
  );
  await flush();
  expect(result.current?.status).toBe("PENDING_CONFIRMATION");
  fetchStatus.mockResolvedValue(response(confirmed));
  act(() =>
    vi
      .mocked(subscribeOrderStream)
      .mock.calls[0][4]("order_confirmed", { shopId, orderId }),
  );
  await flush();
  expect(fetchStatus).toHaveBeenCalledTimes(2);
  expect(result.current).toEqual(confirmed);
  expect(Date.now()).toBe(started);
});

it("coalesces duplicate events during a read and retains one confirmed state against older responses", async () => {
  const { result } = renderHook(() =>
    useCustomerConfirmation("cafe", orderId, token),
  );
  await flush();
  let complete!: (value: ReturnType<typeof response>) => void;
  fetchStatus.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fetchStatus.mockResolvedValue(response(confirmed));
  const notify = vi.mocked(subscribeOrderStream).mock.calls[0][4];
  act(() => {
    for (let i = 0; i < 5; i++) notify("order_confirmed", { shopId, orderId });
  });
  expect(fetchStatus).toHaveBeenCalledTimes(2);
  await act(async () => complete(response(confirmed)));
  await flush();
  expect(fetchStatus).toHaveBeenCalledTimes(3); // initial + one active + one coalesced read
  expect(result.current).toEqual(confirmed);
  fetchStatus.mockResolvedValue(response(pending));
  act(() => notify("resync", { shopId, orderId }));
  await flush();
  expect(result.current).toEqual(confirmed);
});

it("updates preparation immediately and does not regress after duplicates or an older confirmation", async () => {
  fetchStatus.mockResolvedValue(response(confirmed));
  const started = Date.now();
  const { result } = renderHook(() =>
    useCustomerConfirmation("cafe", orderId, token),
  );
  await flush();
  const preparing = {
    ...confirmed,
    preparationStatus: "PREPARING",
    preparationStartedAt: "2026-10-15T01:02:00Z",
    updatedAt: "2026-10-15T01:02:00Z",
  };
  fetchStatus.mockResolvedValue(response(preparing));
  const notify = vi.mocked(subscribeOrderStream).mock.calls[0][4];
  act(() => {
    for (let i = 0; i < 3; i++) notify("order_preparing", { shopId, orderId });
  });
  await flush();
  expect(result.current).toEqual(preparing);
  expect(Date.now()).toBe(started);
  fetchStatus.mockResolvedValue(response(confirmed));
  act(() => notify("resync", { shopId, orderId }));
  await flush();
  expect(result.current).toEqual(preparing);
});

it("updates READY on the event without polling and ignores duplicates and older preparation data", async () => {
  const preparing = {
    ...confirmed,
    preparationStatus: "PREPARING",
    preparationStartedAt: "2026-10-15T01:02:00Z",
    updatedAt: "2026-10-15T01:02:00Z",
  };
  fetchStatus.mockResolvedValue(response(preparing));
  const started = Date.now();
  const { result } = renderHook(() =>
    useCustomerConfirmation("cafe", orderId, token),
  );
  await flush();
  const ready = {
    ...preparing,
    preparationStatus: "READY",
    preparationReadyAt: "2026-10-15T01:03:00Z",
    updatedAt: "2026-10-15T01:03:00Z",
  };
  fetchStatus.mockResolvedValue(response(ready));
  const notify = vi.mocked(subscribeOrderStream).mock.calls[0][4];
  act(() => {
    for (let i = 0; i < 3; i++) notify("order_ready", { shopId, orderId });
  });
  await flush();
  expect(result.current).toEqual(ready);
  expect(Date.now()).toBe(started);
  fetchStatus.mockResolvedValue(response(preparing));
  act(() => notify("resync", { shopId, orderId }));
  await flush();
  expect(result.current).toEqual(ready);
});
