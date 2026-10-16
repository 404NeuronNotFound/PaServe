import { expect, it, vi } from "vitest";
import type { ActiveOrdersResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { getActiveOrders, parseActiveOrders } from "./active-orders";

const response = (): ActiveOrdersResponse => ({
  orders: [
    {
      id: "order-a",
      shopId: "shop-a",
      orderNumber: "ORD-000042",
      mode: "DINE_IN",
      tableNumber: "Patio 2",
      status: "PENDING_CONFIRMATION",
      paymentStatus: "UNPAID",
      preparationStatus: null,
      currency: "PHP",
      totalPrice: "1234567.89",
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
  ],
  nextCursor: null,
});

it("accepts pending and each confirmed non-final preparation state", () => {
  expect(parseActiveOrders(response(), "shop-a").orders).toHaveLength(1);
  for (const preparationStatus of [
    null,
    "QUEUED",
    "PREPARING",
    "READY",
  ] as const) {
    const data = response();
    Object.assign(data.orders[0], {
      status: "CONFIRMED",
      paymentStatus: "PAID",
      preparationStatus,
    });
    expect(parseActiveOrders(data, "shop-a").orders[0].preparationStatus).toBe(
      preparationStatus,
    );
  }
});
it.each([
  { shopId: "foreign" },
  { status: "REJECTED" },
  { preparationStatus: "COMPLETED" },
  { paymentStatus: "PAID" },
  { totalPrice: "-1.00" },
  { totalPrice: "12.3" },
  { createdAt: "2026-02-30T00:00:00.000Z" },
  { updatedAt: "2020-01-01T00:00:00.000Z" },
  { tableNumber: "" },
  { mode: "TAKEOUT", tableNumber: "2" },
])("rejects mismatched, terminal or corrupt rows: %j", (patch) => {
  const data = response();
  Object.assign(data.orders[0], patch);
  expect(() => parseActiveOrders(data, "shop-a")).toThrow();
});
it("rejects duplicate rows and malformed cursors", () => {
  const data = response();
  data.orders.push(data.orders[0]);
  expect(() => parseActiveOrders(data, "shop-a")).toThrow();
  expect(() =>
    parseActiveOrders({ ...response(), nextCursor: "!" }, "shop-a"),
  ).toThrow();
});
it("captures the shop, cursor, abort signal and timeout in the API request", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: response() });
  try {
    const signal = new AbortController().signal;
    await getActiveOrders("shop-a", "cursor", signal);
    expect(get).toHaveBeenCalledWith(
      "/shops/shop-a/orders/active",
      expect.objectContaining({
        params: { cursor: "cursor" },
        signal,
        timeout: expect.any(Number),
      }),
    );
  } finally {
    get.mockRestore();
  }
});
