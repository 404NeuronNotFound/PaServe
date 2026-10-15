import type {
  PreparationQueueResponse,
  StartPreparationResponse,
  ReadyPreparationResponse,
  PreparationStatus,
  CompletePreparationResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";
import { parseCashierItems } from "../cashier/order-items";

export function parseQueue(
  data: PreparationQueueResponse,
  shopId: string,
  state: PreparationStatus = "QUEUED",
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
      state !== "QUEUED" &&
      (typeof order.preparationStartedAt !== "string" ||
        !Number.isFinite(Date.parse(order.preparationStartedAt)) ||
        Date.parse(order.preparationStartedAt) < Date.parse(order.queuedAt) ||
        typeof order.preparationStartedBy !== "string" ||
        !order.preparationStartedBy)
    )
      throw invalid();
    if (
      state === "READY" || state === "COMPLETED"
        ? typeof order.preparationReadyAt !== "string" ||
          !Number.isFinite(Date.parse(order.preparationReadyAt)) ||
          Date.parse(order.preparationReadyAt) <
            Date.parse(order.preparationStartedAt!) ||
          typeof order.preparationReadyBy !== "string" ||
          !order.preparationReadyBy
        : order.preparationReadyAt != null || order.preparationReadyBy != null
    )
      throw invalid();
    if (
      state === "COMPLETED"
        ? typeof order.completedAt !== "string" ||
          !Number.isFinite(Date.parse(order.completedAt)) ||
          Date.parse(order.completedAt) <
            Date.parse(order.preparationReadyAt!) ||
          typeof order.completedBy !== "string" ||
          !order.completedBy
        : order.completedAt != null || order.completedBy != null
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
  state: PreparationStatus = "QUEUED",
) {
  const { data } = await api.get<PreparationQueueResponse>(
    `/shops/${encodeURIComponent(shopId)}/preparation/${state === "QUEUED" ? "queue" : state === "PREPARING" ? "preparing" : state === "READY" ? "ready" : "completed"}`,
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

export async function markReady(shopId: string, orderId: string) {
  const { data } = await api.post<ReadyPreparationResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}/mark-ready`,
    {},
    { timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  const order = data?.order;
  if (
    !order ||
    order.id !== orderId ||
    order.shopId !== shopId ||
    order.preparationStatus !== "READY" ||
    typeof data.alreadyReady !== "boolean" ||
    typeof order.preparationStartedBy !== "string" ||
    !order.preparationStartedBy ||
    typeof order.preparationReadyBy !== "string" ||
    !order.preparationReadyBy ||
    ![
      order.queuedAt,
      order.preparationStartedAt,
      order.preparationReadyAt,
    ].every(
      (value) =>
        typeof value === "string" && Number.isFinite(Date.parse(value)),
    ) ||
    Date.parse(order.preparationStartedAt) < Date.parse(order.queuedAt) ||
    Date.parse(order.preparationReadyAt) <
      Date.parse(order.preparationStartedAt)
  )
    throw new Error(
      "The ready status could not be verified. Refresh before trying again.",
    );
  return data;
}
export async function completeOrder(shopId: string, orderId: string) {
  const { data } = await api.post<CompletePreparationResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}/complete`,
    {},
    { timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  const order = data?.order;
  if (
    !order ||
    order.id !== orderId ||
    order.shopId !== shopId ||
    order.preparationStatus !== "COMPLETED" ||
    typeof data.alreadyCompleted !== "boolean" ||
    ![
      order.preparationStartedBy,
      order.preparationReadyBy,
      order.completedBy,
    ].every((value) => typeof value === "string" && value.length > 0) ||
    ![
      order.queuedAt,
      order.preparationStartedAt,
      order.preparationReadyAt,
      order.completedAt,
    ].every(
      (value) =>
        typeof value === "string" && Number.isFinite(Date.parse(value)),
    ) ||
    Date.parse(order.preparationStartedAt) < Date.parse(order.queuedAt) ||
    Date.parse(order.preparationReadyAt) <
      Date.parse(order.preparationStartedAt) ||
    Date.parse(order.completedAt) < Date.parse(order.preparationReadyAt)
  )
    throw new Error(
      "Completion could not be verified. Refresh before trying again.",
    );
  return data;
}
