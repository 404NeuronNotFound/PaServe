import { afterEach, expect, it, vi } from "vitest";
import { salesDailyRange, type PeakHoursResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { getPeakHours } from "./peak-hours";
const fixture = (): PeakHoursResponse => ({
  shopId: "shop",
  startDate: "2026-10-15",
  endDate: "2026-10-17",
  from: salesDailyRange("2026-10-15", "2026-10-17")!.from,
  to: salesDailyRange("2026-10-15", "2026-10-17")!.to,
  timezone: "Asia/Manila",
  timeBasis: "COMPLETED_AT",
  currency: "PHP",
  completedOrders: 4,
  totalSales: "0.30",
  peakHours: [0, 23],
  hours: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    completedOrders: hour === 0 || hour === 23 ? 2 : 0,
    totalSales: hour === 0 ? "0.10" : hour === 23 ? "0.20" : "0.00",
  })),
});
afterEach(() => vi.restoreAllMocks());
it("requests and verifies every local hour and all tied peaks with cancellation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: fixture() });
  const signal = new AbortController().signal;
  expect(
    await getPeakHours("shop", "2026-10-15", "2026-10-17", signal),
  ).toEqual(fixture());
  expect(get).toHaveBeenCalledWith(
    "/shops/shop/reports/peak-hours",
    expect.objectContaining({
      params: { startDate: "2026-10-15", endDate: "2026-10-17" },
      signal,
    }),
  );
});
it.each([
  "shop",
  "date",
  "timezone",
  "basis",
  "missing",
  "order",
  "duplicate",
  "negative",
  "sales",
  "count",
  "empty",
  "missingPeak",
  "wrongPeak",
  "peakOrder",
])("rejects inconsistent %s", async (kind) => {
  const data = fixture();
  if (kind === "shop") data.shopId = "foreign";
  if (kind === "date") data.startDate = "2026-10-14";
  if (kind === "timezone") data.timezone = "UTC" as never;
  if (kind === "basis") data.timeBasis = "CREATED_AT" as never;
  if (kind === "missing") data.hours.pop();
  if (kind === "order") data.hours.reverse();
  if (kind === "duplicate") data.hours[1].hour = 0;
  if (kind === "negative") data.hours[0].completedOrders = -1;
  if (kind === "sales") data.totalSales = "0.31";
  if (kind === "count") data.completedOrders = 5;
  if (kind === "empty") data.hours[1].totalSales = "0.01";
  if (kind === "missingPeak") data.peakHours.pop();
  if (kind === "wrongPeak") data.peakHours = [1];
  if (kind === "peakOrder") data.peakHours.reverse();
  vi.spyOn(api, "get").mockResolvedValue({ data });
  await expect(
    getPeakHours(
      "shop",
      "2026-10-15",
      "2026-10-17",
      new AbortController().signal,
    ),
  ).rejects.toThrow("could not be verified");
});
