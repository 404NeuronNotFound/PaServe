import {
  SALES_TIMEZONE,
  salesTrendRanges,
  type SalesTrendsResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";

const money = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(value);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
export async function getSalesTrends(
  shopId: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) {
  const ranges = salesTrendRanges(startDate, endDate);
  if (!ranges)
    throw new Error(
      "Choose a valid range of at most 366 days with a preceding comparison period.",
    );
  const { data } = await api.get<SalesTrendsResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/sales-trends`,
    {
      params: { startDate, endDate },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  const invalid = () => {
    throw new Error("Sales trends could not be verified. Please retry.");
  };
  if (
    !data ||
    data.shopId !== shopId ||
    data.timezone !== SALES_TIMEZONE ||
    data.currency !== "PHP" ||
    data.comparisonBasis !== "PREVIOUS_EQUAL_PERIOD"
  )
    return invalid();
  for (const key of ["current", "previous"] as const) {
    const value = data[key],
      range = ranges[key];
    if (
      !value ||
      value.startDate !== range.dates[0] ||
      value.endDate !== range.dates.at(-1) ||
      value.from !== range.from ||
      value.to !== range.to ||
      value.currency !== "PHP" ||
      !count(value.completedOrders) ||
      !money(value.totalSales) ||
      !Array.isArray(value.days) ||
      value.days.length !== range.dates.length
    )
      return invalid();
    let orders = 0n,
      cents = 0n;
    for (const [index, day] of value.days.entries()) {
      if (
        !day ||
        day.businessDate !== range.dates[index] ||
        !count(day.completedOrders) ||
        !money(day.totalSales) ||
        (day.completedOrders === 0 && day.totalSales !== "0.00")
      )
        return invalid();
      orders += BigInt(day.completedOrders);
      cents += BigInt(day.totalSales.replace(".", ""));
    }
    if (
      orders !== BigInt(value.completedOrders) ||
      cents !== BigInt(value.totalSales.replace(".", ""))
    )
      return invalid();
  }
  return data;
}
/** Signed change / previous, rounded half up to two decimals using integers. */
export function trendPercentage(
  current: bigint,
  previous: bigint,
): string | null {
  if (current < 0n || previous < 0n)
    throw new Error("Trend values must be nonnegative.");
  if (previous === 0n) return current === 0n ? "0.00%" : null;
  const difference = current - previous,
    absolute = difference < 0n ? -difference : difference;
  const numerator = absolute * 10000n;
  const rounded =
    numerator / previous + (2n * (numerator % previous) >= previous ? 1n : 0n);
  return `${difference < 0n ? "-" : difference > 0n ? "+" : ""}${rounded / 100n}.${String(rounded % 100n).padStart(2, "0")}%`;
}
