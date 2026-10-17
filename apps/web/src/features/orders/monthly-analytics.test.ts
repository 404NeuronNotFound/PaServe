import { afterEach, expect, it, vi } from "vitest";
import { salesMonthlyRange } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { getMonthlyAnalytics } from "./monthly-analytics";

const fixture = () => ({
  shopId: "shop",
  startDate: "2028-02-29",
  endDate: "2028-03-01",
  from: salesMonthlyRange("2028-02-29", "2028-03-01")!.from,
  to: salesMonthlyRange("2028-02-29", "2028-03-01")!.to,
  timezone: "Asia/Manila",
  currency: "PHP",
  aggregation: "CALENDAR_MONTH",
  totalSales: "0.30",
  completedOrders: 2,
  itemsSold: 3,
  months: salesMonthlyRange("2028-02-29", "2028-03-01")!.months.map(
    (period, i) => ({
      ...period,
      totalSales: i === 0 ? "0.30" : "0.00",
      completedOrders: i === 0 ? 2 : 0,
      itemsSold: i === 0 ? 3 : 0,
    }),
  ),
});
afterEach(() => vi.restoreAllMocks());
it("requests exact calendar-month coverage with cancellation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: fixture() });
  const signal = new AbortController().signal;
  expect(
    await getMonthlyAnalytics("shop", "2028-02-29", "2028-03-01", signal),
  ).toEqual(fixture());
  expect(get).toHaveBeenCalledWith(
    "/shops/shop/reports/monthly-analytics",
    expect.objectContaining({
      params: { startDate: "2028-02-29", endDate: "2028-03-01" },
      signal,
    }),
  );
});
it.each([
  "shop",
  "missing",
  "order",
  "month",
  "boundary",
  "coverage",
  "partial",
  "sales",
  "counts",
  "empty",
  "aggregation",
])("rejects inconsistent %s", async (kind) => {
  const data = fixture();
  if (kind === "shop") data.shopId = "foreign";
  if (kind === "missing") data.months.pop();
  if (kind === "order") data.months.reverse();
  if (kind === "month") data.months[0].month = "2027-02";
  if (kind === "boundary") data.months[0].monthEnd = "2028-02-28";
  if (kind === "coverage") data.months[0].fromDate = "2028-02-01";
  if (kind === "partial") data.months[0].partial = false;
  if (kind === "sales") data.totalSales = "0.31";
  if (kind === "counts") data.completedOrders = 4;
  if (kind === "empty") data.months[1].itemsSold = 1;
  if (kind === "aggregation") data.aggregation = "ROLLING_30_DAYS";
  vi.spyOn(api, "get").mockResolvedValue({ data });
  await expect(
    getMonthlyAnalytics(
      "shop",
      "2028-02-29",
      "2028-03-01",
      new AbortController().signal,
    ),
  ).rejects.toThrow("could not be verified");
});
it("rejects an invalid range before requesting", async () => {
  const get = vi.spyOn(api, "get");
  await expect(
    getMonthlyAnalytics(
      "shop",
      "2026-02-29",
      "2026-03-01",
      new AbortController().signal,
    ),
  ).rejects.toThrow("ordered business date range");
  expect(get).not.toHaveBeenCalled();
});
