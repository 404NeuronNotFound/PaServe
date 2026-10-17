import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api/client";
import { getDailySales } from "./daily-sales";
import {
  SALES_PAYMENT_METHODS,
  type DailySalesResponse,
  type RecentSalesOrder,
} from "@paserve/contracts";

const paymentGroups = (total = "12345678901234.30", orders = 30) =>
  SALES_PAYMENT_METHODS.map((paymentMethod) => ({
    paymentMethod,
    orders: paymentMethod === "CASH" ? orders : 0,
    totalSales: paymentMethod === "CASH" ? total : "0.00",
  }));
const recent = (
  index = 0,
  changes: Partial<RecentSalesOrder> = {},
): RecentSalesOrder => ({
  id: `00000000-0000-4000-8000-${String(100 - index).padStart(12, "0")}`,
  shopId: "shop-a",
  orderNumber: `ORD-${String(42 - index).padStart(6, "0")}`,
  status: "CONFIRMED",
  paymentStatus: "PAID",
  preparationStatus: "COMPLETED",
  currency: "PHP",
  totalPrice: "123.45",
  completedAt: "2026-10-16T00:00:00.000Z",
  ...changes,
});
const feed = () => Array.from({ length: 10 }, (_, index) => recent(index));
const changedFirst = (changes: Partial<RecentSalesOrder>) => [
  recent(0, changes),
  ...feed().slice(1),
];
const response = (
  changes: Partial<DailySalesResponse> = {},
): DailySalesResponse => ({
  shopId: "shop-a",
  businessDate: "2026-10-16",
  timezone: "Asia/Manila",
  from: "2026-10-15T16:00:00.000Z",
  to: "2026-10-16T16:00:00.000Z",
  currency: "PHP",
  completedOrders: 30,
  itemsSold: 75,
  recentOrders: feed(),
  totalSales: "12345678901234.30",
  paymentBreakdown: paymentGroups(),
  ...changes,
});
afterEach(() => vi.restoreAllMocks());

it("requests the explicit business date, keeps cancellation, and preserves exact totals", async () => {
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
it("accepts stable descending ties and reconciles a complete small-day feed", async () => {
  const recentOrders = [recent(), recent(1)];
  vi.spyOn(api, "get").mockResolvedValue({
    data: response({
      completedOrders: 2,
      recentOrders,
      totalSales: "246.90",
      paymentBreakdown: paymentGroups("246.90", 2),
    }),
  });
  expect(
    (await getDailySales("shop-a", "2026-10-16", new AbortController().signal))
      .recentOrders,
  ).toEqual(recentOrders);
});
it("accepts zero sales with eligible zero-value orders", async () => {
  const recentOrders = [recent(0, { totalPrice: "0.00" })];
  vi.spyOn(api, "get").mockResolvedValue({
    data: response({
      completedOrders: 1,
      recentOrders,
      totalSales: "0.00",
      paymentBreakdown: paymentGroups("0.00", 1),
    }),
  });
  expect(
    (await getDailySales("shop-a", "2026-10-16", new AbortController().signal))
      .completedOrders,
  ).toBe(1);
});
it("accepts an empty day only with zero metrics and an empty feed", async () => {
  const data = response({
    completedOrders: 0,
    itemsSold: 0,
    recentOrders: [],
    totalSales: "0.00",
    paymentBreakdown: paymentGroups("0.00", 0),
  });
  vi.spyOn(api, "get").mockResolvedValue({ data });
  expect(
    await getDailySales("shop-a", "2026-10-16", new AbortController().signal),
  ).toEqual(data);
});
it.each([
  undefined,
  [],
  feed().slice(0, 9),
  [null, ...feed().slice(1)],
  changedFirst({ shopId: "shop-b" }),
  changedFirst({ id: "../bad" }),
  changedFirst({ id: "order-z" }),
  changedFirst({ id: "00000000-0000-4000-8000-000000000100\n" }),
  changedFirst({ totalPrice: "NaN" }),
  changedFirst({ completedAt: "2026-10-16T16:00:00.000Z" }),
  changedFirst({ completedAt: "2026-10-15T15:59:59.999Z" }),
  changedFirst({ completedAt: "not-a-date" }),
  changedFirst({ preparationStatus: "QUEUED" } as never),
  changedFirst({ paymentStatus: "UNPAID" } as never),
  [recent(), recent(), ...feed().slice(2)],
  [
    recent(),
    recent(1, { orderNumber: recent().orderNumber }),
    ...feed().slice(2),
  ],
  [recent(1), recent(), ...feed().slice(2)],
  [
    recent(),
    recent(1, { completedAt: "2026-10-16T01:00:00.000Z" }),
    ...feed().slice(2),
  ],
  Array.from({ length: 11 }, (_, index) => recent(index)),
])(
  "rejects incomplete, foreign, malformed or misordered recent orders %j",
  async (recentOrders) => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: { ...response(), recentOrders },
    });
    await expect(
      getDailySales("shop-a", "2026-10-16", new AbortController().signal),
    ).rejects.toThrow("Recent orders could not be verified");
  },
);
it.each(["0.10", "300.00"])(
  "rejects a complete feed whose amounts disagree with gross sales %s",
  async (totalSales) => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: response({
        completedOrders: 2,
        totalSales,
        paymentBreakdown: paymentGroups(totalSales, 2),
        recentOrders: [recent(), recent(1)],
      }),
    });
    await expect(
      getDailySales("shop-a", "2026-10-16", new AbortController().signal),
    ).rejects.toThrow("Recent orders do not match");
  },
);
it("rejects a ten-order page whose subtotal exceeds the full day's sales", async () => {
  vi.spyOn(api, "get").mockResolvedValue({
    data: response({
      totalSales: "0.01",
      paymentBreakdown: paymentGroups("0.01", 30),
    }),
  });
  await expect(
    getDailySales("shop-a", "2026-10-16", new AbortController().signal),
  ).rejects.toThrow("Recent orders do not match");
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
  response().paymentBreakdown.map((row) =>
    row.paymentMethod === "CASH"
      ? { ...row, totalSales: row.totalSales + "\n" }
      : row,
  ),
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
it.each([
  { shopId: "shop-b" },
  { businessDate: "2026-10-15" },
  { timezone: "UTC" },
  { from: "2026-10-16T00:00:00.000Z" },
  { totalSales: 123 },
  { totalSales: "1.234" },
  { totalSales: "12345678901234.30\n" },
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
])("rejects a mismatched or malformed report %j", async (change) => {
  vi.spyOn(api, "get").mockResolvedValue({
    data: { ...response(), ...change },
  });
  await expect(
    getDailySales("shop-a", "2026-10-16", new AbortController().signal),
  ).rejects.toThrow("could not be verified");
});
it.each(["", "2026-02-29", "2026-02-30", "2026-13-01"])(
  "rejects invalid dates before a network request %s",
  async (date) => {
    const get = vi.spyOn(api, "get");
    await expect(
      getDailySales("shop-a", date, new AbortController().signal),
    ).rejects.toThrow("Choose a valid business date");
    expect(get).not.toHaveBeenCalled();
  },
);
