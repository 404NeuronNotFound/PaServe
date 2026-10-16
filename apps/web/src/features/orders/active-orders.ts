import type {
  ActiveOrdersResponse,
  OwnerOrderFilters,
} from "@paserve/contracts";
import { isReceiptTimestamp } from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";

export const activeOrdersKey = (
  userId: string,
  shopId: string,
  cursor: string | null,
  search = "",
  filters: OwnerOrderFilters = {},
) =>
  [
    "owner-orders",
    userId,
    shopId,
    "active",
    cursor,
    ...(search ? [search] : []),
    ...(Object.keys(filters).length ? [filters] : []),
  ] as const;

export function parseActiveOrders(
  data: ActiveOrdersResponse,
  shopId: string,
): ActiveOrdersResponse {
  const invalid = () =>
    new Error("Active orders could not be verified. Please refresh.");
  if (
    !data ||
    !Array.isArray(data.orders) ||
    data.orders.length > 25 ||
    !(
      data.nextCursor === null ||
      (typeof data.nextCursor === "string" &&
        /^[A-Za-z0-9_-]{1,200}$/.test(data.nextCursor))
    )
  )
    throw invalid();
  const ids = new Set<string>();
  for (const order of data.orders) {
    if (
      !order ||
      typeof order.id !== "string" ||
      !order.id ||
      ids.has(order.id) ||
      order.shopId !== shopId ||
      !isOrderNumber(order.orderNumber) ||
      !["PENDING_CONFIRMATION", "CONFIRMED"].includes(order.status) ||
      !["UNPAID", "PAID"].includes(order.paymentStatus) ||
      !(
        order.preparationStatus === null ||
        ["QUEUED", "PREPARING", "READY"].includes(order.preparationStatus)
      ) ||
      (order.status === "PENDING_CONFIRMATION" &&
        (order.paymentStatus !== "UNPAID" ||
          order.preparationStatus !== null)) ||
      (order.preparationStatus !== null &&
        (order.status !== "CONFIRMED" || order.paymentStatus !== "PAID")) ||
      order.currency !== "PHP" ||
      !isOrderTotal(order.totalPrice) ||
      !isReceiptTimestamp(order.createdAt) ||
      !isReceiptTimestamp(order.updatedAt) ||
      Date.parse(order.updatedAt) < Date.parse(order.createdAt) ||
      (order.mode === "DINE_IN"
        ? typeof order.tableNumber !== "string" || !order.tableNumber.trim()
        : order.mode !== "TAKEOUT" || order.tableNumber !== null)
    )
      throw invalid();
    ids.add(order.id);
  }
  return data;
}

export async function getActiveOrders(
  shopId: string,
  cursor: string | null,
  signal: AbortSignal,
  search = "",
  filters: OwnerOrderFilters = {},
) {
  const { data } = await api.get<ActiveOrdersResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/active`,
    {
      params: {
        ...filters,
        ...(cursor ? { cursor } : {}),
        ...(search ? { search } : {}),
      },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  return parseActiveOrders(data, shopId);
}
