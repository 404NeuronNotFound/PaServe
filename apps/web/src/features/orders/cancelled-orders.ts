import { isValidOrderService } from "@paserve/contracts";
import type {
  CancelledOrdersResponse,
  OwnerOrderFilters,
} from "@paserve/contracts";
import { isReceiptTimestamp } from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";

export const cancelledOrdersKey = (
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
    "cancelled",
    cursor,
    ...(search ? [search] : []),
    ...(Object.keys(filters).length ? [filters] : []),
  ] as const;

export function parseCancelledOrders(
  data: CancelledOrdersResponse,
  shopId: string,
): CancelledOrdersResponse {
  const invalid = () =>
    new Error(
      "Cancelled / rejected orders could not be verified. Please refresh.",
    );
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
      !isValidOrderService(order.mode, order.serviceType) ||
      order.status !== "REJECTED" ||
      order.paymentStatus !== "UNPAID" ||
      order.preparationStatus !== null ||
      order.currency !== "PHP" ||
      !isOrderTotal(order.totalPrice) ||
      !isReceiptTimestamp(order.createdAt) ||
      !(
        order.decidedAt === null ||
        (isReceiptTimestamp(order.decidedAt) &&
          Date.parse(order.decidedAt) >= Date.parse(order.createdAt))
      ) ||
      !(
        order.decidedBy === null ||
        (typeof order.decidedBy === "string" && !!order.decidedBy.trim())
      ) ||
      !(
        order.rejectionReason === null ||
        (typeof order.rejectionReason === "string" &&
          !!order.rejectionReason.trim() &&
          order.rejectionReason.length <= 300)
      ) ||
      (order.mode === "DINE_IN"
        ? typeof order.tableNumber !== "string" || !order.tableNumber.trim()
        : order.mode !== "TAKEOUT" || order.tableNumber !== null)
    )
      throw invalid();
    ids.add(order.id);
  }
  return data;
}

export async function getCancelledOrders(
  shopId: string,
  cursor: string | null,
  signal: AbortSignal,
  search = "",
  filters: OwnerOrderFilters = {},
) {
  const { data } = await api.get<CancelledOrdersResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/cancelled`,
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
  return parseCancelledOrders(data, shopId);
}
