import type {
  PreparationQueueResponse,
  StartPreparationResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";
import { parseCashierItems } from "../cashier/order-items";

export function parseQueue(
  data: PreparationQueueResponse,
  shopId: string,
  state: "QUEUED" | "PREPARING" = "QUEUED",
): PreparationQueueResponse {
  const invalid = () =>
    new Error("The saved queue could not be verified. Refresh to try again.");
  if (
    !data ||
    !Array.isArray(data.orders) ||
    data.orders.length > 50 ||
    !(
      data.nextCursor === null ||
      (typeof data.nextCursor === "string" &&
        /^[A-Za-z0-9_-]{1,200}$/.test(data.nextCursor))
    )
  )
    throw invalid();
  const ids = new Set<string>();
  const orders = data.orders.map((order) => {
    if (
      !order ||
      typeof order.id !== "string" ||
      !order.id ||
      ids.has(order.id) ||
      order.shopId !== shopId ||
      !isOrderNumber(order.orderNumber) ||
      order.preparationStatus !== state ||
      order.currency !== "PHP" ||
      !isOrderTotal(order.totalPrice) ||
      typeof order.queuedAt !== "string" ||
      !Number.isFinite(Date.parse(order.queuedAt)) ||
      (order.mode === "DINE_IN"
        ? typeof order.tableNumber !== "string" || !order.tableNumber.trim()
        : order.mode !== "TAKEOUT" || order.tableNumber !== null)
    )
      throw invalid();
    if (
      state === "PREPARING" &&
      (typeof order.preparationStartedAt !== "string" ||
        !Number.isFinite(Date.parse(order.preparationStartedAt)) ||
        Date.parse(order.preparationStartedAt) < Date.parse(order.queuedAt) ||
        typeof order.preparationStartedBy !== "string" ||
        !order.preparationStartedBy)
    )
      throw invalid();
    if (
      state === "QUEUED" &&
      (order.preparationStartedAt != null || order.preparationStartedBy != null)
    )
      throw invalid();
    const items = parseCashierItems(order.items, order.totalPrice);
    if (!items) throw invalid();
    ids.add(order.id);
    return { ...order, items };
  });
  return { orders, nextCursor: data.nextCursor };
}

export async function getPreparationQueue(
  shopId: string,
  cursor: string | null,
  signal: AbortSignal,
  state: "QUEUED" | "PREPARING" = "QUEUED",
) {
  const { data } = await api.get<PreparationQueueResponse>(
    `/shops/${encodeURIComponent(shopId)}/preparation/${state === "QUEUED" ? "queue" : "preparing"}`,
    {
      params: cursor ? { cursor } : undefined,
      signal,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    },
  );
  return parseQueue(data, shopId, state);
}

export async function startPreparing(shopId: string, orderId: string) {
  const { data } = await api.post<StartPreparationResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}/start-preparing`,
    {},
    { timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  const order = data?.order;
  if (
    !order ||
    order.id !== orderId ||
    order.shopId !== shopId ||
    order.preparationStatus !== "PREPARING" ||
    typeof data.alreadyStarted !== "boolean" ||
    typeof order.preparationStartedBy !== "string" ||
    !order.preparationStartedBy ||
    typeof order.queuedAt !== "string" ||
    typeof order.preparationStartedAt !== "string" ||
    !Number.isFinite(Date.parse(order.queuedAt)) ||
    !Number.isFinite(Date.parse(order.preparationStartedAt)) ||
    Date.parse(order.preparationStartedAt) < Date.parse(order.queuedAt)
  )
    throw new Error(
      "The preparation start could not be verified. Refresh before trying again.",
    );
  return data;
}
