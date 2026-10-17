import {
  SALES_TIMEZONE,
  salesWeeklyRange,
  type WeeklyAnalyticsResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";

const money = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(value);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
export async function getWeeklyAnalytics(
  shopId: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) {
  const range = salesWeeklyRange(startDate, endDate);
  if (!range)
    throw new Error(
      "Choose an ordered business date range of at most 366 days.",
    );
  const { data } = await api.get<WeeklyAnalyticsResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/weekly-analytics`,
    {
      params: { startDate, endDate },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  const invalid = () => {
    throw new Error("Weekly analytics could not be verified. Please retry.");
  };
  if (
    !data ||
    data.shopId !== shopId ||
    data.startDate !== startDate ||
    data.endDate !== endDate ||
    data.from !== range.from ||
    data.to !== range.to ||
    data.timezone !== SALES_TIMEZONE ||
    data.currency !== "PHP" ||
    data.weekStartsOn !== "MONDAY" ||
    !money(data.totalSales) ||
    !count(data.completedOrders) ||
    !count(data.itemsSold) ||
    !Array.isArray(data.weeks) ||
    data.weeks.length !== range.weeks.length
  )
    return invalid();
  let cents = 0n,
    orders = 0n,
    items = 0n;
  for (const [index, week] of data.weeks.entries()) {
    const expected = range.weeks[index];
    if (
      !week ||
      week.weekStart !== expected.weekStart ||
      week.weekEnd !== expected.weekEnd ||
      week.fromDate !== expected.fromDate ||
      week.toDate !== expected.toDate ||
      week.partial !== expected.partial ||
      !money(week.totalSales) ||
      !count(week.completedOrders) ||
      !count(week.itemsSold) ||
      (week.completedOrders === 0 &&
        (week.totalSales !== "0.00" || week.itemsSold !== 0))
    )
      return invalid();
    cents += BigInt(week.totalSales.replace(".", ""));
    orders += BigInt(week.completedOrders);
    items += BigInt(week.itemsSold);
  }
  if (
    cents !== BigInt(data.totalSales.replace(".", "")) ||
    orders !== BigInt(data.completedOrders) ||
    items !== BigInt(data.itemsSold)
  )
    return invalid();
  return data;
}
