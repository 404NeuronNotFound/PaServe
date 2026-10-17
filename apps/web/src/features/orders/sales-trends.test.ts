import { afterEach, expect, it, vi } from "vitest";
import { salesTrendRanges, type SalesTrendsResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { getSalesTrends, trendPercentage } from "./sales-trends";
const fixture = (): SalesTrendsResponse => {
  const ranges = salesTrendRanges("2026-10-15", "2026-10-16")!;
  const period = (range: typeof ranges.current) => ({
    startDate: range.dates[0],
    endDate: range.dates.at(-1)!,
    from: range.from,
    to: range.to,
    currency: "PHP" as const,
    completedOrders: 1,
    totalSales: "0.01",
    days: range.dates.map((businessDate, i) => ({
      businessDate,
      completedOrders: i === 0 ? 1 : 0,
      totalSales: i === 0 ? "0.01" : "0.00",
    })),
  });
  return {
    shopId: "shop",
    timezone: "Asia/Manila",
    currency: "PHP",
    comparisonBasis: "PREVIOUS_EQUAL_PERIOD",
    current: period(ranges.current),
    previous: period(ranges.previous),
  };
};
afterEach(() => vi.restoreAllMocks());
it("requests both verified periods with cancellation and timeout", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: fixture() });
  const signal = new AbortController().signal;
  expect(
    await getSalesTrends("shop", "2026-10-15", "2026-10-16", signal),
  ).toEqual(fixture());
  expect(get).toHaveBeenCalledWith(
    "/shops/shop/reports/sales-trends",
    expect.objectContaining({
      params: { startDate: "2026-10-15", endDate: "2026-10-16" },
      signal,
      timeout: expect.any(Number),
    }),
  );
});
it.each([
  "shop",
  "timezone",
  "currency",
  "basis",
  "priorDates",
  "bounds",
  "missingDay",
  "duplicateDay",
  "negative",
  "money",
  "totals",
  "zeroOrderSales",
  "unsafeCount",
] as const)("rejects invalid response: %s", async (kind) => {
  const data = fixture();
  switch (kind) {
    case "shop":
      data.shopId = "foreign";
      break;
    case "timezone":
      Object.assign(data, { timezone: "UTC" });
      break;
    case "currency":
      Object.assign(data, { currency: "USD" });
      break;
    case "basis":
      Object.assign(data, { comparisonBasis: "YEAR_AGO" });
      break;
    case "priorDates":
      data.previous.startDate = "2026-10-14";
      break;
    case "bounds":
      data.current.to = "2026-10-17T00:00:00.000Z";
      break;
    case "missingDay":
      data.previous.days.pop();
      break;
    case "duplicateDay":
      data.current.days[1].businessDate = data.current.days[0].businessDate;
      break;
    case "negative":
      data.current.days[0].completedOrders = -1;
      break;
    case "money":
      data.current.days[0].totalSales = "0.01\n";
      break;
    case "totals":
      data.previous.totalSales = "0.02";
      break;
    case "zeroOrderSales":
      data.previous.days[0].completedOrders = 0;
      data.previous.completedOrders = 0;
      break;
    case "unsafeCount":
      data.current.completedOrders = Number.MAX_SAFE_INTEGER + 1;
      break;
  }
  vi.spyOn(api, "get").mockResolvedValue({ data });
  await expect(
    getSalesTrends(
      "shop",
      "2026-10-15",
      "2026-10-16",
      new AbortController().signal,
    ),
  ).rejects.toThrow("could not be verified");
});
it("rejects unsupported comparison dates before requesting", async () => {
  const get = vi.spyOn(api, "get");
  await expect(
    getSalesTrends(
      "shop",
      "0001-01-01",
      "0001-01-01",
      new AbortController().signal,
    ),
  ).rejects.toThrow("valid range");
  expect(get).not.toHaveBeenCalled();
});
it.each([
  [150n, 100n, "+50.00%"],
  [50n, 100n, "-50.00%"],
  [0n, 100n, "-100.00%"],
  [100n, 100n, "0.00%"],
  [0n, 0n, "0.00%"],
  [1n, 0n, null],
  [1n, 3n, "-66.67%"],
  [20001n, 20000n, "+0.01%"],
  [900719925474099300n, 9007199254740993n, "+9900.00%"],
])("calculates exact percent change %s / %s", (current, previous, expected) =>
  expect(trendPercentage(current, previous)).toBe(expected),
);
