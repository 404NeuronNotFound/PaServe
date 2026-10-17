import {
  SALES_TIMEZONE,
  salesDailyRange,
  type PeakHoursResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
const money = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(value);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
export async function getPeakHours(
  shopId: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) {
  const range = salesDailyRange(startDate, endDate);
  if (!range) throw new Error("Choose a valid date range of at most 366 days.");
  const { data } = await api.get<PeakHoursResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/peak-hours`,
    {
      params: { startDate, endDate },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  const invalid = () => {
    throw new Error("Peak hours could not be verified. Please retry.");
  };
  if (
    !data ||
    data.shopId !== shopId ||
    data.startDate !== startDate ||
    data.endDate !== endDate ||
    data.from !== range.from ||
    data.to !== range.to ||
    data.timezone !== SALES_TIMEZONE ||
    data.timeBasis !== "COMPLETED_AT" ||
    data.currency !== "PHP" ||
    !count(data.completedOrders) ||
    !money(data.totalSales) ||
    !Array.isArray(data.hours) ||
    data.hours.length !== 24 ||
    !Array.isArray(data.peakHours)
  )
    return invalid();
  let orders = 0n,
    cents = 0n,
    peak = 0;
  for (const [index, hour] of data.hours.entries()) {
    if (
      !hour ||
      hour.hour !== index ||
      !count(hour.completedOrders) ||
      !money(hour.totalSales) ||
      (hour.completedOrders === 0 && hour.totalSales !== "0.00")
    )
      return invalid();
    orders += BigInt(hour.completedOrders);
    cents += BigInt(hour.totalSales.replace(".", ""));
    peak = Math.max(peak, hour.completedOrders);
  }
  const expectedPeaks =
    peak === 0
      ? []
      : data.hours
          .filter((hour) => hour.completedOrders === peak)
          .map((hour) => hour.hour);
  if (
    orders !== BigInt(data.completedOrders) ||
    cents !== BigInt(data.totalSales.replace(".", "")) ||
    data.peakHours.length !== expectedPeaks.length ||
    data.peakHours.some((hour, index) => hour !== expectedPeaks[index])
  )
    return invalid();
  return data;
}
