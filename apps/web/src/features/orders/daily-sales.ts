import {
  SALES_TIMEZONE,
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
    (data.completedOrders === 0 && data.totalSales !== "0.00")
  ) {
    throw new Error("Sales could not be verified. Please refresh.");
  }
  return data;
}
