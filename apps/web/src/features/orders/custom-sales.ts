import { salesDailyRange, type CustomSalesResponse } from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import { verifySalesReport } from "./daily-sales";

export async function getCustomSales(
  shopId: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) {
  const bounds = salesDailyRange(startDate, endDate);
  if (!bounds)
    throw new Error("Choose valid start/end dates spanning at most 366 days.");
  const { data } = await api.get<CustomSalesResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/custom-sales`,
    {
      params: { startDate, endDate },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  if (!data || data.startDate !== startDate || data.endDate !== endDate)
    throw new Error(
      "The selected sales period could not be verified. Please retry.",
    );
  return verifySalesReport(data, shopId, bounds);
}
