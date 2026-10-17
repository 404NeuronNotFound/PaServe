import {
  SALES_TIMEZONE,
  TOP_PRODUCT_METRICS,
  salesDailyRange,
  type TopProductEntry,
  type TopProductMetric,
  type TopProductsResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
const money = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(value);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
// PostgreSQL COLLATE "C" compares UTF-8 bytes, not locale/UTF-16 sort order.
function compareSnapshotIds(first: string, second: string) {
  const encoder = new TextEncoder(),
    a = encoder.encode(first),
    b = encoder.encode(second);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
export async function getTopProducts(
  shopId: string,
  startDate: string,
  endDate: string,
  metric: TopProductMetric,
  signal: AbortSignal,
) {
  const range = salesDailyRange(startDate, endDate);
  if (!range || !TOP_PRODUCT_METRICS.includes(metric))
    throw new Error("Choose valid dates and a ranking metric.");
  const { data } = await api.get<TopProductsResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/top-products`,
    {
      params: { startDate, endDate, metric },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  const invalid = () => {
    throw new Error("Top products could not be verified. Please retry.");
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
    data.metric !== metric ||
    data.limit !== 10 ||
    !count(data.productCount) ||
    !count(data.totalQuantity) ||
    !count(data.otherQuantity) ||
    !money(data.totalRevenue) ||
    !money(data.otherRevenue) ||
    !Array.isArray(data.products) ||
    data.products.length !== Math.min(10, data.productCount)
  )
    return invalid();
  const ids = new Set<string>();
  let quantity = BigInt(data.otherQuantity),
    cents = BigInt(data.otherRevenue.replace(".", ""));
  const rankValue = (entry: TopProductEntry, by: TopProductMetric) =>
    by === "QUANTITY"
      ? BigInt(entry.quantity)
      : BigInt(entry.revenue.replace(".", ""));
  for (const [index, entry] of data.products.entries()) {
    if (
      !entry ||
      typeof entry.productSnapshotId !== "string" ||
      !entry.productSnapshotId ||
      entry.productSnapshotId.length > 1000 ||
      ids.has(entry.productSnapshotId) ||
      typeof entry.productName !== "string" ||
      !entry.productName ||
      entry.productName.length > 1000 ||
      !count(entry.quantity) ||
      entry.quantity === 0 ||
      !money(entry.revenue)
    )
      return invalid();
    const previous = data.products[index - 1];
    if (
      previous &&
      (rankValue(previous, metric) < rankValue(entry, metric) ||
        (rankValue(previous, metric) === rankValue(entry, metric) &&
          rankValue(previous, metric === "QUANTITY" ? "REVENUE" : "QUANTITY") <
            rankValue(entry, metric === "QUANTITY" ? "REVENUE" : "QUANTITY")) ||
        (previous.quantity === entry.quantity &&
          previous.revenue === entry.revenue &&
          compareSnapshotIds(
            previous.productSnapshotId,
            entry.productSnapshotId,
          ) > 0))
    )
      return invalid();
    ids.add(entry.productSnapshotId);
    quantity += BigInt(entry.quantity);
    cents += BigInt(entry.revenue.replace(".", ""));
  }
  if (
    quantity !== BigInt(data.totalQuantity) ||
    cents !== BigInt(data.totalRevenue.replace(".", "")) ||
    data.otherQuantity < Math.max(0, data.productCount - 10) ||
    (data.productCount <= 10 &&
      (data.otherQuantity !== 0 || data.otherRevenue !== "0.00")) ||
    (data.productCount === 0 &&
      (data.totalQuantity !== 0 || data.totalRevenue !== "0.00"))
  )
    return invalid();
  return data;
}
