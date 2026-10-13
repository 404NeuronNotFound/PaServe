import type { VerifyOrderQrResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import "../auth/api/session";
import { AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";
import { parseCashierItems } from "./order-items";

import { parseOrderQr } from "../orders/order-qr-reference";
export {
  parseOrderQr,
  type OrderQrReference,
} from "../orders/order-qr-reference";
export async function verifyScannedOrder(
  shopId: string,
  qrToken: string,
  signal: AbortSignal,
) {
  const reference = parseOrderQr(qrToken);
  if (!reference) throw new Error("This is not a PaServe order QR.");
  if (reference.shopId !== shopId)
    throw new Error("This order QR belongs to another shop.");
  const { data } = await api.post<VerifyOrderQrResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/scan-qr`,
    { qrToken: reference.qrToken },
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  return parseReview(data, shopId, reference.orderId);
}
export async function lookupOrderNumber(
  shopId: string,
  rawNumber: string,
  signal: AbortSignal,
) {
  const orderNumber = rawNumber.trim().toUpperCase();
  if (!isOrderNumber(orderNumber))
    throw new Error("Enter a valid order number, such as ORD-000006.");
  const { data } = await api.post<VerifyOrderQrResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/lookup-number`,
    { orderNumber },
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  if (
    data?.order?.orderNumber !== orderNumber ||
    typeof data.order.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      data.order.id,
    )
  )
    throw new Error(
      "The order lookup response could not be verified. Please try again.",
    );
  return parseReview(data, shopId, data.order.id);
}
function parseReview(
  data: VerifyOrderQrResponse,
  shopId: string,
  orderId: string,
) {
  if (
    !data ||
    data.verified !== true ||
    data.order?.id !== orderId ||
    data.order.shopId !== shopId ||
    !isOrderNumber(data.order.orderNumber) ||
    !["DINE_IN", "TAKEOUT"].includes(data.order.mode) ||
    data.order.currency !== "PHP" ||
    !isOrderTotal(data.order.totalPrice) ||
    data.order.status !== "PENDING_CONFIRMATION" ||
    data.order.paymentStatus !== "UNPAID" ||
    typeof data.order.reviewVersion !== "string" ||
    !/^[a-f0-9]{64}$(?![\s\S])/.test(data.order.reviewVersion) ||
    !(
      data.order.tableNumber === null ||
      typeof data.order.tableNumber === "string"
    )
  )
    throw new Error(
      "The order verification response could not be verified. Please try again.",
    );
  const items = parseCashierItems(data.order.items, data.order.totalPrice);
  if (!items)
    throw new Error(
      "The order's saved items could not be loaded. Please try again or ask the shop owner for help.",
    );
  if (
    data.order.mode === "DINE_IN"
      ? !data.order.tableNumber?.trim()
      : data.order.tableNumber !== null
  )
    throw new Error(
      "The order type and table could not be verified. Please try again.",
    );
  const {
    id,
    orderNumber,
    mode,
    status,
    paymentStatus,
    currency,
    totalPrice,
    tableNumber,
    reviewVersion,
  } = data.order;
  return {
    id,
    shopId,
    orderNumber,
    mode,
    status,
    paymentStatus,
    currency,
    totalPrice,
    tableNumber,
    reviewVersion,
    items,
  };
}
