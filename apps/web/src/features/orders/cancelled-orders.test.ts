import { expect, it, vi } from "vitest";
import type { CancelledOrdersResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import {
  cancelledOrdersKey,
  getCancelledOrders,
  parseCancelledOrders,
} from "./cancelled-orders";

const response = (): CancelledOrdersResponse => ({
  orders: [
    {
      id: "order-a",
      shopId: "shop-a",
      orderNumber: "ORD-000042",
      mode: "DINE_IN",
      tableNumber: "Patio 2",
      status: "REJECTED",
      paymentStatus: "UNPAID",
      preparationStatus: null,
      currency: "PHP",
      totalPrice: "1234567.89",
      createdAt: "2026-10-16T00:00:00.000Z",
      decidedAt: "2026-10-16T00:01:00.000Z",
      decidedBy: "saved-actor-id",
      rejectionReason: "Item unavailable",
    },
  ],
  nextCursor: null,
});

it("accepts captured reason/actor without changing them", () => {
  expect(parseCancelledOrders(response(), "shop-a").orders[0]).toMatchObject({
    status: "REJECTED",
    decidedBy: "saved-actor-id",
    rejectionReason: "Item unavailable",
  });
});
it("accepts absent decision metadata, takeout and zero-total historical orders", () => {
  const data = response();
  Object.assign(data.orders[0], {
    mode: "TAKEOUT",
    tableNumber: null,
    totalPrice: "0.00",
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
  });
  expect(parseCancelledOrders(data, "shop-a")).toBe(data);
});
it.each([
  { shopId: "foreign" },
  { status: "PENDING_CONFIRMATION" },
  { status: "CONFIRMED" },
  { status: "CANCELLED" },
  { paymentStatus: "PAID" },
  { preparationStatus: "READY" },
  { preparationStatus: "COMPLETED" },
  { totalPrice: "-1.00" },
  { totalPrice: "12.3" },
  { currency: "USD" },
  { decidedAt: "2026-02-30T00:00:00.000Z" },
  { decidedAt: "2026-10-15T00:00:00.000Z" },
  { decidedBy: 42 },
  { decidedBy: "" },
  { rejectionReason: 42 },
  { rejectionReason: "" },
  { rejectionReason: "x".repeat(301) },
  { tableNumber: "" },
  { mode: "TAKEOUT", tableNumber: "2" },
])("rejects foreign, active/fulfilled and corrupt history: %j", (patch) => {
  const data = response();
  Object.assign(data.orders[0], patch);
  expect(() => parseCancelledOrders(data, "shop-a")).toThrow();
});
it("rejects duplicate rows, oversized pages and malformed cursors", () => {
  const data = response();
  data.orders.push(data.orders[0]);
  expect(() => parseCancelledOrders(data, "shop-a")).toThrow();
  expect(() =>
    parseCancelledOrders({ ...response(), nextCursor: "!" }, "shop-a"),
  ).toThrow();
  expect(() =>
    parseCancelledOrders(
      {
        orders: Array.from({ length: 26 }, (_, i) => ({
          ...response().orders[0],
          id: `order-${i}`,
        })),
        nextCursor: null,
      },
      "shop-a",
    ),
  ).toThrow();
});
it("captures shop/cursor/signal/timeout and separates cancelled cache keys", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: response() });
  try {
    const signal = new AbortController().signal;
    await getCancelledOrders("shop-a", "cursor", signal);
    expect(get).toHaveBeenCalledWith(
      "/shops/shop-a/orders/cancelled",
      expect.objectContaining({
        params: { cursor: "cursor" },
        signal,
        timeout: expect.any(Number),
      }),
    );
    expect(cancelledOrdersKey("user-a", "shop-a", null)).toEqual([
      "owner-orders",
      "user-a",
      "shop-a",
      "cancelled",
      null,
    ]);
  } finally {
    get.mockRestore();
  }
});
