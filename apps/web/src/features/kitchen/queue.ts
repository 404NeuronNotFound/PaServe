import type { PreparationQueueResponse } from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";
import { parseCashierItems } from "../cashier/order-items";

export function parseQueue(data: PreparationQueueResponse, shopId: string): PreparationQueueResponse {
  const invalid = () => new Error("The saved queue could not be verified. Refresh to try again.");
  if (!data || !Array.isArray(data.orders) || data.orders.length > 50 ||
    !(data.nextCursor === null || (typeof data.nextCursor === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(data.nextCursor)))) throw invalid();
  const ids = new Set<string>();
  const orders = data.orders.map((order) => {
    if (!order || typeof order.id !== "string" || !order.id || ids.has(order.id) ||
      order.shopId !== shopId || !isOrderNumber(order.orderNumber) ||
      order.preparationStatus !== "QUEUED" || order.currency !== "PHP" || !isOrderTotal(order.totalPrice) ||
      typeof order.queuedAt !== "string" || !Number.isFinite(Date.parse(order.queuedAt)) ||
      (order.mode === "DINE_IN" ? typeof order.tableNumber !== "string" || !order.tableNumber.trim() :
        order.mode !== "TAKEOUT" || order.tableNumber !== null)) throw invalid();
    const items = parseCashierItems(order.items, order.totalPrice);
    if (!items) throw invalid();
    ids.add(order.id);
    return { ...order, items };
  });
  return { orders, nextCursor: data.nextCursor };
}

export async function getPreparationQueue(shopId: string, cursor: string | null, signal: AbortSignal) {
  const { data } = await api.get<PreparationQueueResponse>(
    `/shops/${encodeURIComponent(shopId)}/preparation/queue`,
    { params: cursor ? { cursor } : undefined, signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  return parseQueue(data, shopId);
}
