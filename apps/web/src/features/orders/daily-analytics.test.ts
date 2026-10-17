import { afterEach, expect, it, vi } from "vitest";
import { salesDailyRange } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { getDailyAnalytics } from "./daily-analytics";

const fixture = () => ({
  shopId: "shop",
  startDate: "2026-10-15",
  endDate: "2026-10-16",
  from: salesDailyRange("2026-10-15", "2026-10-16")!.from,
  to: salesDailyRange("2026-10-15", "2026-10-16")!.to,
  timezone: "Asia/Manila",
  currency: "PHP",
  totalSales: "0.30",
  completedOrders: 2,
  itemsSold: 3,
  days: [
    {
      businessDate: "2026-10-15",
      totalSales: "0.30",
      completedOrders: 2,
      itemsSold: 3,
    },
    {
      businessDate: "2026-10-16",
      totalSales: "0.00",
      completedOrders: 0,
      itemsSold: 0,
    },
  ],
});
afterEach(() => vi.restoreAllMocks());
it("requests the inclusive range with cancellation and verifies totals", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: fixture() });
  const signal = new AbortController().signal;
  expect(
    await getDailyAnalytics("shop", "2026-10-15", "2026-10-16", signal),
  ).toEqual(fixture());
  expect(get).toHaveBeenCalledWith(
    "/shops/shop/reports/daily-analytics",
    expect.objectContaining({
      params: { startDate: "2026-10-15", endDate: "2026-10-16" },
      signal,
    }),
  );
});
it.each(["shop", "missing", "order", "money", "count", "items", "empty"])(
  "rejects inconsistent %s data",
  async (kind) => {
    const data = fixture();
    if (kind === "shop") data.shopId = "foreign";
    if (kind === "missing") data.days.pop();
    if (kind === "order") data.days.reverse();
    if (kind === "money") data.totalSales = "0.31";
    if (kind === "count") data.completedOrders = 4;
    if (kind === "items") data.itemsSold = 4;
    if (kind === "empty") data.days[1].itemsSold = 1;
    vi.spyOn(api, "get").mockResolvedValue({ data });
    await expect(
      getDailyAnalytics(
        "shop",
        "2026-10-15",
        "2026-10-16",
        new AbortController().signal,
      ),
    ).rejects.toThrow("could not be verified");
  },
);
