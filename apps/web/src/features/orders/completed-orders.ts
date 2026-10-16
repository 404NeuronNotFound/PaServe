import type { CompletedOrdersResponse } from "@paserve/contracts";
import { isReceiptTimestamp } from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";

export const completedOrdersKey = (
  userId: string,
  shopId: string,
  cursor: string | null,
  search = "",
) =>
  [
    "owner-orders",
    userId,
    shopId,
    "completed",
    cursor,
    ...(search ? [search] : []),
  ] as const;

export function parseCompletedOrders(
  data: CompletedOrdersResponse,
  shopId: string,
): CompletedOrdersResponse {
  const invalid = () =>
    new Error("Completed orders could not be verified. Please refresh.");
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
      order.status !== "CONFIRMED" ||
      order.paymentStatus !== "PAID" ||
      order.preparationStatus !== "COMPLETED" ||
      !["CASH", "GCASH_MANUAL", "CARD_MANUAL", "OTHER"].includes(
        order.paymentMethod,
      ) ||
      order.currency !== "PHP" ||
      !isOrderTotal(order.totalPrice) ||
      !isReceiptTimestamp(order.createdAt) ||
      !isReceiptTimestamp(order.paidAt) ||
      !isReceiptTimestamp(order.completedAt) ||
      Date.parse(order.paidAt) < Date.parse(order.createdAt) ||
      Date.parse(order.completedAt) < Date.parse(order.paidAt) ||
      (order.mode === "DINE_IN"
        ? typeof order.tableNumber !== "string" || !order.tableNumber.trim()
        : order.mode !== "TAKEOUT" || order.tableNumber !== null)
    )
      throw invalid();
    ids.add(order.id);
  }
  return data;
}

export async function getCompletedOrders(
  shopId: string,
  cursor: string | null,
  signal: AbortSignal,
  search = "",
) {
  const { data } = await api.get<CompletedOrdersResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/completed`,
    {
      params: { ...(cursor ? { cursor } : {}), ...(search ? { search } : {}) },
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  return parseCompletedOrders(data, shopId);
}
