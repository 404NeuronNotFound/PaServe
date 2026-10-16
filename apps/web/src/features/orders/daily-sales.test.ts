import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api/client";
import { getDailySales } from "./daily-sales";
import {
  SALES_PAYMENT_METHODS,
  type RecentSalesOrder,
} from "@paserve/contracts";

const response = () => ({
  shopId: "shop-a",
  businessDate: "2026-10-16",
  timezone: "Asia/Manila",
  from: "2026-10-15T16:00:00.000Z",
  to: "2026-10-16T16:00:00.000Z",
  currency: "PHP",
  completedOrders: 30,
  itemsSold: 75,
  recentOrders: [],
  totalSales: "12345678901234.30",
  paymentBreakdown: SALES_PAYMENT_METHODS.map((paymentMethod) => ({
    paymentMethod,
    orders: paymentMethod === "CASH" ? 30 : 0,
    totalSales: paymentMethod === "CASH" ? "12345678901234.30" : "0.00",
  })),
});

const recent = (changes: Partial<RecentSalesOrder> = {}): RecentSalesOrder => ({
  id: "order-z",
  shopId: "shop-a",
  orderNumber: "ORD-000042",
  status: "CONFIRMED",
  paymentStatus: "PAID",
  preparationStatus: "COMPLETED",
  currency: "PHP",
  totalPrice: "123.45",
  completedAt: "2026-10-16T00:00:00.000Z",
  ...changes,
});
it("accepts a recent-order feed with stable descending ties and saved amounts", async () => {
  const recentOrders = [recent(), recent({ id: "order-a" })];
  vi.spyOn(api, "get").mockResolvedValue({
    data: { ...response(), recentOrders },
  });
  expect(
    (await getDailySales("shop-a", "2026-10-16", new AbortController().signal))
      .recentOrders,
  ).toEqual(recentOrders);
});
it.each([
  undefined,
  [null],
  [recent({ shopId: "shop-b" })],
  [recent({ id: "../bad" })],
  [recent({ totalPrice: "NaN" })],
  [recent({ completedAt: "2026-10-16T16:00:00.000Z" })],
  [recent({ completedAt: "2026-10-15T15:59:59.999Z" })],
  [recent({ preparationStatus: "QUEUED" } as never)],
  [recent(), recent()],
  [recent({ id: "order-a" }), recent()],
  [
    recent(),
    recent({ id: "order-a", completedAt: "2026-10-16T01:00:00.000Z" }),
  ],
  Array.from({ length: 11 }, (_, index) => recent({ id: `order-${index}` })),
])("rejects invalid recent-order data %j", async (recentOrders) => {
  vi.spyOn(api, "get").mockResolvedValue({
    data: { ...response(), recentOrders },
  });
  await expect(
    getDailySales("shop-a", "2026-10-16", new AbortController().signal),
  ).rejects.toThrow("Recent orders could not be verified");
});

it.each([
  undefined,
  [],
  [{ paymentMethod: "CASH", orders: 30, totalSales: "12345678901234.30" }],
  response().paymentBreakdown.map((row) => ({ ...row, paymentMethod: "CASH" })),
  response().paymentBreakdown.map((row) => ({ ...row, orders: -1 })),
  response().paymentBreakdown.map((row) => ({ ...row, orders: 1.5 })),
  response().paymentBreakdown.map((row) => ({ ...row, totalSales: "NaN" })),
  response().paymentBreakdown.map((row) => ({ ...row, totalSales: "0.00" })),
  response().paymentBreakdown.map((row) => ({ ...row, orders: 0 })),
])(
  "rejects malformed or non-reconciling payment groups %j",
  async (paymentBreakdown) => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: { ...response(), paymentBreakdown },
    });
    await expect(
      getDailySales("shop-a", "2026-10-16", new AbortController().signal),
    ).rejects.toThrow("Payment breakdown");
  },
);
afterEach(() => vi.restoreAllMocks());
it("requests the explicit business date and preserves large exact sales totals", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: response() });
  const signal = new AbortController().signal;
  expect(await getDailySales("shop-a", "2026-10-16", signal)).toEqual(
    response(),
  );
  expect(get).toHaveBeenCalledWith(
    "/shops/shop-a/reports/daily-sales",
    expect.objectContaining({ params: { date: "2026-10-16" }, signal }),
  );
});
it.each([
  { shopId: "shop-b" },
  { businessDate: "2026-10-15" },
  { timezone: "UTC" },
  { from: "2026-10-16T00:00:00.000Z" },
  { totalSales: 123 },
  { totalSales: "1.234" },
  { completedOrders: -1 },
  { completedOrders: 1.5 },
  { completedOrders: "2" },
  { completedOrders: Number.MAX_SAFE_INTEGER + 1 },
  { completedOrders: 0 },
  { itemsSold: undefined },
  { itemsSold: -1 },
  { itemsSold: 1.5 },
  { itemsSold: "3" },
  { itemsSold: Number.MAX_SAFE_INTEGER + 1 },
])("rejects a mismatched or malformed report: %j", async (change) => {
  vi.spyOn(api, "get").mockResolvedValue({
    data: { ...response(), ...change },
  });
  await expect(
    getDailySales("shop-a", "2026-10-16", new AbortController().signal),
  ).rejects.toThrow("could not be verified");
});
