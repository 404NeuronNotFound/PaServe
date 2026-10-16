import {
  cashAmountCents,
  isReceiptTimestamp,
  parseReceiptPaymentDetails,
  parseReceiptShopDetails,
  type OwnerOrderDetailsResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";
import { parseReceiptItems } from "../cart/receipt-items";

export const orderDetailsKey = (
  userId: string,
  shopId: string,
  orderId: string,
) => ["owner-order-details", userId, shopId, orderId] as const;

export function parseOrderDetails(
  data: OwnerOrderDetailsResponse,
  shopId: string,
  orderId: string,
): OwnerOrderDetailsResponse {
  const order = data?.order;
  const invalid = () =>
    new Error(
      "The saved order details could not be verified. Refresh to try again.",
    );
  if (
    !order ||
    order.id !== orderId ||
    order.shopId !== shopId ||
    !isOrderNumber(order.orderNumber) ||
    !["PENDING_CONFIRMATION", "CONFIRMED", "REJECTED"].includes(order.status) ||
    !["UNPAID", "PAID"].includes(order.paymentStatus) ||
    !(
      order.preparationStatus === null ||
      ["QUEUED", "PREPARING", "READY", "COMPLETED"].includes(
        order.preparationStatus,
      )
    ) ||
    order.currency !== "PHP" ||
    !isOrderTotal(order.totalPrice) ||
    !isReceiptTimestamp(order.createdAt) ||
    !isReceiptTimestamp(order.updatedAt) ||
    !(order.paidAt === null || isReceiptTimestamp(order.paidAt)) ||
    !(order.completedAt === null || isReceiptTimestamp(order.completedAt)) ||
    (order.mode === "DINE_IN"
      ? typeof order.tableNumber !== "string" || !order.tableNumber.trim()
      : order.mode !== "TAKEOUT" || order.tableNumber !== null) ||
    !(
      order.rejectionReason === null ||
      typeof order.rejectionReason === "string"
    ) ||
    !(
      order.snapshotIssue === null || typeof order.snapshotIssue === "string"
    ) ||
    !Array.isArray(order.history) ||
    order.history.length > 8 ||
    !Array.isArray(order.permittedActions)
  )
    throw invalid();
  const items =
    order.items === null
      ? null
      : parseReceiptItems(order.items, order.totalPrice);
  if (
    (order.items !== null && !items) ||
    (!items && !order.snapshotIssue) ||
    (order.shopDetails !== null &&
      !parseReceiptShopDetails(order.shopDetails)) ||
    (order.payment !== null && !parseReceiptPaymentDetails(order.payment))
  )
    throw invalid();
  const payment =
    order.payment === null ? null : parseReceiptPaymentDetails(order.payment);
  if (
    payment?.method === "CASH" &&
    payment.amountReceived !== undefined &&
    (payment.changeDue === undefined ||
      cashAmountCents(payment.amountReceived)! -
        cashAmountCents(payment.changeDue)! !==
        cashAmountCents(order.totalPrice))
  )
    throw invalid();
  const milestones = [
    "PLACED",
    "CONFIRMED",
    "REJECTED",
    "PAID",
    "QUEUED",
    "PREPARING",
    "READY",
    "COMPLETED",
  ];
  const seen = new Set<string>();
  let previous = -Infinity;
  for (const event of order.history) {
    if (
      !event ||
      !milestones.includes(event.status) ||
      seen.has(event.status) ||
      !isReceiptTimestamp(event.at) ||
      Date.parse(event.at) < previous ||
      !(
        event.actorId === null ||
        (typeof event.actorId === "string" && !!event.actorId)
      )
    )
      throw invalid();
    previous = Date.parse(event.at);
    seen.add(event.status);
  }
  const allowed = new Set<string>();
  if (items && !order.snapshotIssue) {
    if (
      ["PENDING_CONFIRMATION", "CONFIRMED"].includes(order.status) &&
      order.paymentStatus === "UNPAID" &&
      order.preparationStatus === null
    )
      allowed.add("CASHIER");
    if (order.status === "CONFIRMED" && order.paymentStatus === "PAID") {
      allowed.add("RECEIPT");
      if (order.preparationStatus === "QUEUED") allowed.add("START_PREPARING");
      if (order.preparationStatus === "PREPARING") allowed.add("MARK_READY");
      if (order.preparationStatus === "READY") allowed.add("COMPLETE");
    }
  }
  if (
    new Set(order.permittedActions).size !== order.permittedActions.length ||
    order.permittedActions.some((action) => !allowed.has(action))
  )
    throw invalid();
  return {
    order: {
      ...order,
      items,
      payment:
        order.payment === null
          ? null
          : parseReceiptPaymentDetails(order.payment),
    },
  };
}

export async function getOrderDetails(
  shopId: string,
  orderId: string,
  signal: AbortSignal,
) {
  const { data } = await api.get<OwnerOrderDetailsResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}/details`,
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  return parseOrderDetails(data, shopId, orderId);
}
