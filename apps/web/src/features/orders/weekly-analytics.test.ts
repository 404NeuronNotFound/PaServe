import { afterEach, expect, it, vi } from "vitest";
import { salesWeeklyRange } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { getWeeklyAnalytics } from "./weekly-analytics";

const fixture = () => ({
  shopId: "shop",
  startDate: "2026-10-18",
  endDate: "2026-10-19",
  from: salesWeeklyRange("2026-10-18", "2026-10-19")!.from,
  to: salesWeeklyRange("2026-10-18", "2026-10-19")!.to,
  timezone: "Asia/Manila",
  currency: "PHP",
  weekStartsOn: "MONDAY",
  totalSales: "0.30",
  completedOrders: 2,
  itemsSold: 3,
  weeks: salesWeeklyRange("2026-10-18", "2026-10-19")!.weeks.map(
    (period, i) => ({
      ...period,
      totalSales: i === 0 ? "0.30" : "0.00",
      completedOrders: i === 0 ? 2 : 0,
      itemsSold: i === 0 ? 3 : 0,
    }),
  ),
});
afterEach(() => vi.restoreAllMocks());
it("requests and verifies Monday-Sunday weeks with cancellation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: fixture() });
  const signal = new AbortController().signal;
  expect(
    await getWeeklyAnalytics("shop", "2026-10-18", "2026-10-19", signal),
  ).toEqual(fixture());
  expect(get).toHaveBeenCalledWith(
    "/shops/shop/reports/weekly-analytics",
    expect.objectContaining({
      params: { startDate: "2026-10-18", endDate: "2026-10-19" },
      signal,
    }),
  );
});
it.each([
  "shop",
  "missing",
  "order",
  "boundary",
  "coverage",
  "partial",
  "sales",
  "counts",
  "empty",
  "startDay",
])("rejects inconsistent %s", async (kind) => {
  const data = fixture();
  if (kind === "shop") data.shopId = "foreign";
  if (kind === "missing") data.weeks.pop();
  if (kind === "order") data.weeks.reverse();
  if (kind === "boundary") data.weeks[0].weekStart = "2026-10-11";
  if (kind === "coverage") data.weeks[0].fromDate = "2026-10-12";
  if (kind === "partial") data.weeks[0].partial = false;
  if (kind === "sales") data.totalSales = "0.31";
  if (kind === "counts") data.completedOrders = 4;
  if (kind === "empty") data.weeks[1].itemsSold = 1;
  if (kind === "startDay") data.weekStartsOn = "SUNDAY";
  vi.spyOn(api, "get").mockResolvedValue({ data });
  await expect(
    getWeeklyAnalytics(
      "shop",
      "2026-10-18",
      "2026-10-19",
      new AbortController().signal,
    ),
  ).rejects.toThrow("could not be verified");
});
