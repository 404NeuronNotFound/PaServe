import { expect, it, vi } from "vitest";
import type { CompletedOrdersResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import {
  completedOrdersKey,
  getCompletedOrders,
  parseCompletedOrders,
} from "./completed-orders";

const response = (): CompletedOrdersResponse => ({
  orders: [
    {
      id: "order-a",
      shopId: "shop-a",
      orderNumber: "ORD-000042",
      mode: "DINE_IN",
      tableNumber: "Patio 2",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      preparationStatus: "COMPLETED",
      paymentMethod: "CASH",
      currency: "PHP",
      totalPrice: "1234567.89",
      createdAt: "2026-10-16T00:00:00.000Z",
      paidAt: "2026-10-16T00:01:00.000Z",
      completedAt: "2026-10-16T00:05:00.000Z",
    },
  ],
  nextCursor: null,
});

it.each(["CASH", "GCASH_MANUAL", "CARD_MANUAL", "OTHER"] as const)(
  "accepts fulfilled %s orders without changing saved amounts",
  (paymentMethod) => {
    const data = response();
    data.orders[0].paymentMethod = paymentMethod;
    expect(parseCompletedOrders(data, "shop-a").orders[0].totalPrice).toBe(
      "1234567.89",
    );
  },
);
it.each([
  { shopId: "foreign" },
  { status: "PENDING_CONFIRMATION" },
  { status: "REJECTED" },
  { paymentStatus: "UNPAID" },
  { preparationStatus: "READY" },
  { preparationStatus: null },
  { paymentMethod: null },
  { paymentMethod: "STRIPE" },
  { totalPrice: "-1.00" },
  { totalPrice: "12.3" },
  { currency: "USD" },
  { completedAt: null },
  { completedAt: "2026-02-30T00:00:00.000Z" },
  { completedAt: "2026-10-15T00:00:00.000Z" },
  { paidAt: "2020-01-01T00:00:00.000Z" },
  { tableNumber: "" },
  { mode: "TAKEOUT", tableNumber: "2" },
])("rejects foreign, unfulfilled and corrupt history: %j", (patch) => {
  const data = response();
  Object.assign(data.orders[0], patch);
  expect(() => parseCompletedOrders(data, "shop-a")).toThrow();
});
it("accepts takeout without a table, zero-total orders and empty history", () => {
  const data = response();
  Object.assign(data.orders[0], {
    mode: "TAKEOUT",
    tableNumber: null,
    totalPrice: "0.00",
  });
  expect(parseCompletedOrders(data, "shop-a")).toBe(data);
  expect(
    parseCompletedOrders({ orders: [], nextCursor: null }, "shop-a").orders,
  ).toHaveLength(0);
});
it("rejects duplicate rows, oversized pages and malformed cursors", () => {
  const data = response();
  data.orders.push(data.orders[0]);
  expect(() => parseCompletedOrders(data, "shop-a")).toThrow();
  expect(() =>
    parseCompletedOrders({ ...response(), nextCursor: "!" }, "shop-a"),
  ).toThrow();
  expect(() =>
    parseCompletedOrders(
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
it("captures shop/cursor/signal/timeout and separates completed cache keys", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: response() });
  try {
    const signal = new AbortController().signal;
    await getCompletedOrders("shop-a", "cursor", signal);
    expect(get).toHaveBeenCalledWith(
      "/shops/shop-a/orders/completed",
      expect.objectContaining({
        params: { cursor: "cursor" },
        signal,
        timeout: expect.any(Number),
      }),
    );
    expect(completedOrdersKey("user-a", "shop-a", null)).toEqual([
      "owner-orders",
      "user-a",
      "shop-a",
      "completed",
      null,
    ]);
  } finally {
    get.mockRestore();
  }
});
