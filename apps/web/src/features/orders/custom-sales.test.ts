import { afterEach, expect, it, vi } from "vitest";
import {
  SALES_PAYMENT_METHODS,
  salesDailyRange,
  type CustomSalesResponse,
} from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { getCustomSales } from "./custom-sales";

const fixture = (): CustomSalesResponse => ({
  shopId: "shop",
  startDate: "2026-10-15",
  endDate: "2026-10-17",
  from: salesDailyRange("2026-10-15", "2026-10-17")!.from,
  to: salesDailyRange("2026-10-15", "2026-10-17")!.to,
  timezone: "Asia/Manila",
  currency: "PHP",
  totalSales: "0.30",
  completedOrders: 2,
  itemsSold: 7,
  paymentBreakdown: SALES_PAYMENT_METHODS.map((paymentMethod) => ({
    paymentMethod,
    orders: paymentMethod === "CASH" ? 2 : 0,
    totalSales: paymentMethod === "CASH" ? "0.30" : "0.00",
  })),
  recentOrders: ["2026-10-17T15:59:59.999Z", "2026-10-14T16:00:00.000Z"].map(
    (completedAt, i) => ({
      id: `00000000-0000-4000-8000-${String(100 - i).padStart(12, "0")}`,
      shopId: "shop",
      orderNumber: `ORD-00000${2 - i}`,
      status: "CONFIRMED",
      paymentStatus: "PAID",
      preparationStatus: "COMPLETED",
      currency: "PHP",
      totalPrice: i === 0 ? "0.20" : "0.10",
      completedAt,
    }),
  ),
});
afterEach(() => vi.restoreAllMocks());
it("requests a complete range with cancellation and verifies every section", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: fixture() });
  const signal = new AbortController().signal;
  expect(
    await getCustomSales("shop", "2026-10-15", "2026-10-17", signal),
  ).toEqual(fixture());
  expect(get).toHaveBeenCalledWith(
    "/shops/shop/reports/custom-sales",
    expect.objectContaining({
      params: { startDate: "2026-10-15", endDate: "2026-10-17" },
      signal,
    }),
  );
});
it.each([
  "shop",
  "date",
  "bounds",
  "money",
  "items",
  "payments",
  "missingFeed",
  "foreignFeed",
  "endBoundary",
  "beforeStart",
])("rejects inconsistent %s", async (kind) => {
  const data = fixture();
  if (kind === "shop") data.shopId = "foreign";
  if (kind === "date") data.endDate = "2026-10-18";
  if (kind === "bounds") data.to = "2026-10-18T16:00:00.000Z";
  if (kind === "money") data.totalSales = "0.31";
  if (kind === "items") data.itemsSold = -1;
  if (kind === "payments") data.paymentBreakdown[0].orders = 3;
  if (kind === "missingFeed") data.recentOrders.pop();
  if (kind === "foreignFeed") data.recentOrders[0].shopId = "foreign";
  if (kind === "endBoundary")
    data.recentOrders[0].completedAt = "2026-10-17T16:00:00.000Z";
  if (kind === "beforeStart")
    data.recentOrders[1].completedAt = "2026-10-14T15:59:59.999Z";
  vi.spyOn(api, "get").mockResolvedValue({ data });
  await expect(
    getCustomSales(
      "shop",
      "2026-10-15",
      "2026-10-17",
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});
it("rejects an invalid range before requesting", async () => {
  const get = vi.spyOn(api, "get");
  await expect(
    getCustomSales(
      "shop",
      "2026-10-18",
      "2026-10-17",
      new AbortController().signal,
    ),
  ).rejects.toThrow("valid start/end");
  expect(get).not.toHaveBeenCalled();
});
