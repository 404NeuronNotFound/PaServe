import {
  SALES_TIMEZONE,
  salesDailyRange,
  type DailyAnalyticsResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";

const money = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(value);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;

export async function getDailyAnalytics(
  shopId: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) {
  const range = salesDailyRange(startDate, endDate);
  if (!range)
    throw new Error("Choose an ordered date range of at most 366 days.");
  const { data } = await api.get<DailyAnalyticsResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/daily-analytics`,
    {
      params: { startDate, endDate },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  const invalid = () => {
    throw new Error("Daily analytics could not be verified. Please retry.");
  };
  if (
    !data ||
    data.shopId !== shopId ||
    data.startDate !== startDate ||
    data.endDate !== endDate ||
    data.timezone !== SALES_TIMEZONE ||
    data.currency !== "PHP" ||
    data.from !== range.from ||
    data.to !== range.to ||
    !money(data.totalSales) ||
    !count(data.completedOrders) ||
    !count(data.itemsSold) ||
    !Array.isArray(data.days) ||
    data.days.length !== range.dates.length
  )
    return invalid();
  let orders = 0,
    items = 0,
    cents = 0n;
  for (const [index, day] of data.days.entries()) {
    if (
      !day ||
      day.businessDate !== range.dates[index] ||
      !count(day.completedOrders) ||
      !count(day.itemsSold) ||
      !money(day.totalSales) ||
      (day.completedOrders === 0 &&
        (day.itemsSold !== 0 || day.totalSales !== "0.00"))
    )
      return invalid();
    orders += day.completedOrders;
    items += day.itemsSold;
    cents += BigInt(day.totalSales.replace(".", ""));
  }
  if (
    orders !== data.completedOrders ||
    items !== data.itemsSold ||
    cents !== BigInt(data.totalSales.replace(".", ""))
  )
    return invalid();
  return data;
}
