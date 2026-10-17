import { afterEach, expect, it, vi } from "vitest";
import {
  salesDailyRange,
  type AveragePrepTimeResponse,
} from "@paserve/contracts";
import { api } from "../../lib/api/client";
import {
  getAveragePrepTime,
  formatPreparationDuration,
} from "./average-prep-time";
const fixture = (): AveragePrepTimeResponse => ({
  shopId: "shop",
  startDate: "2026-10-15",
  endDate: "2026-10-17",
  from: salesDailyRange("2026-10-15", "2026-10-17")!.from,
  to: salesDailyRange("2026-10-15", "2026-10-17")!.to,
  timezone: "Asia/Manila",
  durationBasis: "PREPARING_TO_READY",
  selectionBasis: "COMPLETED_AT",
  eligibleOrders: 5,
  measuredOrders: 2,
  excludedOrders: 3,
  missingTimestamps: 2,
  invalidTimestamps: 1,
  totalDurationMs: "90001",
  averageDurationMs: 45001,
});
afterEach(() => vi.restoreAllMocks());
it("requests and verifies sample coverage and millisecond average with cancellation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: fixture() });
  const signal = new AbortController().signal;
  expect(
    await getAveragePrepTime("shop", "2026-10-15", "2026-10-17", signal),
  ).toEqual(fixture());
  expect(get).toHaveBeenCalledWith(
    "/shops/shop/reports/average-prep-time",
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
  "selection",
  "negative",
  "coverage",
  "reasons",
  "total",
  "average",
  "emptyAverage",
  "emptyTotal",
])("rejects inconsistent %s", async (kind) => {
  const data = fixture();
  if (kind === "shop") data.shopId = "foreign";
  if (kind === "date") data.endDate = "2026-10-18";
  if (kind === "timezone") data.timezone = "UTC" as never;
  if (kind === "basis") data.durationBasis = "PAID_TO_COMPLETED" as never;
  if (kind === "selection") data.selectionBasis = "CREATED_AT" as never;
  if (kind === "negative") data.measuredOrders = -1;
  if (kind === "coverage") data.eligibleOrders = 6;
  if (kind === "reasons") data.missingTimestamps = 3;
  if (kind === "total") data.totalDurationMs = "90001.00";
  if (kind === "average") data.averageDurationMs = 45000;
  if (kind === "emptyAverage" || kind === "emptyTotal") {
    data.measuredOrders = 0;
    data.eligibleOrders = 3;
    data.totalDurationMs = kind === "emptyTotal" ? "1" : "0";
    data.averageDurationMs = kind === "emptyAverage" ? 0 : null;
  }
  vi.spyOn(api, "get").mockResolvedValue({ data });
  await expect(
    getAveragePrepTime(
      "shop",
      "2026-10-15",
      "2026-10-17",
      new AbortController().signal,
    ),
  ).rejects.toThrow("could not be verified");
});
it.each([
  [0, "0s"],
  [1, "0.001s"],
  [333, "0.333s"],
  [1000, "1s"],
  [60000, "1m 0s"],
  [3661500, "1h 1m 1.5s"],
  [90000000, "25h 0s"],
] as const)("formats %i milliseconds as %s", (ms, expected) =>
  expect(formatPreparationDuration(ms)).toBe(expected),
);
