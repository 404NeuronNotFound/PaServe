import {
  SALES_TIMEZONE,
  SALES_PAYMENT_METHODS,
  salesBusinessDayBounds,
  type DailySalesResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";

export async function getDailySales(
  shopId: string,
  date: string,
  signal: AbortSignal,
) {
  const bounds = salesBusinessDayBounds(date);
  if (!bounds) throw new Error("Choose a valid business date.");
  const { data } = await api.get<DailySalesResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/daily-sales`,
    { params: { date }, signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  if (
    !data ||
    data.shopId !== shopId ||
    data.businessDate !== date ||
    data.timezone !== SALES_TIMEZONE ||
    data.from !== bounds.from ||
    data.to !== bounds.to ||
    data.currency !== "PHP" ||
    typeof data.totalSales !== "string" ||
    !/^(?:0|[1-9]\d*)\.\d{2}$/.test(data.totalSales) ||
    !Number.isSafeInteger(data.completedOrders) ||
    data.completedOrders < 0 ||
    !Number.isSafeInteger(data.itemsSold) ||
    data.itemsSold < 0 ||
    (data.completedOrders === 0 && data.itemsSold !== 0) ||
    (data.completedOrders === 0 && data.totalSales !== "0.00")
  ) {
    throw new Error("Sales could not be verified. Please refresh.");
  }
  if (
    !Array.isArray(data.paymentBreakdown) ||
    data.paymentBreakdown.length !== SALES_PAYMENT_METHODS.length
  ) {
    throw new Error("Payment breakdown could not be verified. Please refresh.");
  }
  let orders = 0;
  let cents = 0n;
  for (const [index, entry] of data.paymentBreakdown.entries()) {
    if (
      !entry ||
      entry.paymentMethod !== SALES_PAYMENT_METHODS[index] ||
      !Number.isSafeInteger(entry.orders) ||
      entry.orders < 0 ||
      typeof entry.totalSales !== "string" ||
      !/^(?:0|[1-9]\d*)\.\d{2}$/.test(entry.totalSales) ||
      (entry.orders === 0 && entry.totalSales !== "0.00")
    ) {
      throw new Error(
        "Payment breakdown could not be verified. Please refresh.",
      );
    }
    orders += entry.orders;
    cents += BigInt(entry.totalSales.replace(".", ""));
  }
  if (
    orders !== data.completedOrders ||
    cents !== BigInt(data.totalSales.replace(".", ""))
  ) {
    throw new Error(
      "Payment breakdown does not match the sales summary. Please refresh.",
    );
  }
  return data;
}
