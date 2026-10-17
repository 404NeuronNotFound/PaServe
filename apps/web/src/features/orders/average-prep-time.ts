import {
  SALES_TIMEZONE,
  salesDailyRange,
  type AveragePrepTimeResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
export async function getAveragePrepTime(
  shopId: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) {
  const range = salesDailyRange(startDate, endDate);
  if (!range) throw new Error("Choose a valid date range of at most 366 days.");
  const { data } = await api.get<AveragePrepTimeResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/average-prep-time`,
    {
      params: { startDate, endDate },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  const invalid = () => {
    throw new Error(
      "Average preparation time could not be verified. Please retry.",
    );
  };
  if (
    !data ||
    data.shopId !== shopId ||
    data.startDate !== startDate ||
    data.endDate !== endDate ||
    data.from !== range.from ||
    data.to !== range.to ||
    data.timezone !== SALES_TIMEZONE ||
    data.durationBasis !== "PREPARING_TO_READY" ||
    data.selectionBasis !== "COMPLETED_AT" ||
    !count(data.eligibleOrders) ||
    !count(data.measuredOrders) ||
    !count(data.excludedOrders) ||
    !count(data.missingTimestamps) ||
    !count(data.invalidTimestamps) ||
    typeof data.totalDurationMs !== "string" ||
    !/^(?:0|[1-9]\d*)$(?![\s\S])/.test(data.totalDurationMs)
  )
    return invalid();
  if (
    BigInt(data.measuredOrders) + BigInt(data.excludedOrders) !==
      BigInt(data.eligibleOrders) ||
    BigInt(data.missingTimestamps) + BigInt(data.invalidTimestamps) !==
      BigInt(data.excludedOrders)
  )
    return invalid();
  const total = BigInt(data.totalDurationMs),
    measured = BigInt(data.measuredOrders);
  if (measured === 0n) {
    if (data.averageDurationMs !== null || total !== 0n) return invalid();
  } else {
    if (data.averageDurationMs === null || !count(data.averageDurationMs))
      return invalid();
    const expected =
      total / measured + (2n * (total % measured) >= measured ? 1n : 0n);
    if (BigInt(data.averageDurationMs) !== expected) return invalid();
  }
  return data;
}
export function formatPreparationDuration(milliseconds: number) {
  if (!count(milliseconds)) throw new Error("A valid duration is required.");
  const totalSeconds = Math.floor(milliseconds / 1000),
    hours = Math.floor(totalSeconds / 3600),
    minutes = Math.floor(totalSeconds / 60) % 60;
  const fraction = milliseconds % 1000;
  const seconds = `${totalSeconds % 60}${fraction ? `.${String(fraction).padStart(3, "0").replace(/0+$/, "")}` : ""}s`;
  return `${hours ? `${hours.toLocaleString("en-PH")}h ` : ""}${minutes ? `${minutes}m ` : ""}${seconds}`;
}
