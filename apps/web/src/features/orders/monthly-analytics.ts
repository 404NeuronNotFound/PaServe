import {
  SALES_TIMEZONE,
  salesMonthlyRange,
  type MonthlyAnalyticsResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";

const money = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(value);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
export async function getMonthlyAnalytics(
  shopId: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) {
  const range = salesMonthlyRange(startDate, endDate);
  if (!range)
    throw new Error(
      "Choose an ordered business date range of at most 366 days.",
    );
  const { data } = await api.get<MonthlyAnalyticsResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/monthly-analytics`,
    {
      params: { startDate, endDate },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  const invalid = () => {
    throw new Error("Monthly analytics could not be verified. Please retry.");
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
    data.aggregation !== "CALENDAR_MONTH" ||
    !money(data.totalSales) ||
    !count(data.completedOrders) ||
    !count(data.itemsSold) ||
    !Array.isArray(data.months) ||
    data.months.length !== range.months.length
  )
    return invalid();
  let cents = 0n,
    orders = 0n,
    items = 0n;
  for (const [index, month] of data.months.entries()) {
    const expected = range.months[index];
    if (
      !month ||
      month.month !== expected.month ||
      month.monthStart !== expected.monthStart ||
      month.monthEnd !== expected.monthEnd ||
      month.fromDate !== expected.fromDate ||
      month.toDate !== expected.toDate ||
      month.partial !== expected.partial ||
      !money(month.totalSales) ||
      !count(month.completedOrders) ||
      !count(month.itemsSold) ||
      (month.completedOrders === 0 &&
        (month.totalSales !== "0.00" || month.itemsSold !== 0))
    )
      return invalid();
    cents += BigInt(month.totalSales.replace(".", ""));
    orders += BigInt(month.completedOrders);
    items += BigInt(month.itemsSold);
  }
  if (
    cents !== BigInt(data.totalSales.replace(".", "")) ||
    orders !== BigInt(data.completedOrders) ||
    items !== BigInt(data.itemsSold)
  )
    return invalid();
  return data;
}
