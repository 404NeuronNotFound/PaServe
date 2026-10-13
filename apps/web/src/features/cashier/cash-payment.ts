import {
  cashAmountCents,
  type CashPaymentRequest,
  type CashPaymentReviewResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import { parseReview } from "./order-qr";
import { isOrderNumber } from "../cart/order-receipt-fields";

export function normalizeCashAmount(raw: string): string | null {
  const value = raw.trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}
export function cashChange(amount: string, total: string): string | null {
  const received = cashAmountCents(amount),
    due = cashAmountCents(total);
  if (received === null || due === null || received < due) return null;
  const cents = received - due;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
function parseCash(
  data: CashPaymentReviewResponse,
  shopId: string,
  orderId: string,
): CashPaymentReviewResponse {
  const order = parseReview(
    { verified: true, order: data?.order },
    shopId,
    orderId,
    true,
  );
  const payment = data.payment;
  if (order.paymentStatus === "UNPAID") {
    if (payment !== null)
      throw new Error(
        "The saved payment state could not be verified. Refresh before collecting cash.",
      );
    return { order, payment: null };
  }
  if (
    !payment ||
    payment.method !== "CASH" ||
    typeof payment.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payment.requestId,
    ) ||
    typeof payment.paidBy !== "string" ||
    !payment.paidBy.trim() ||
    typeof payment.paidAt !== "string" ||
    !Number.isFinite(Date.parse(payment.paidAt)) ||
    cashChange(payment.amountReceived, order.totalPrice) !==
      payment.changeDue ||
    cashAmountCents(payment.changeDue) === null
  )
    throw new Error(
      "The saved cash receipt could not be verified. Ask the shop owner for help.",
    );
  return {
    order,
    payment: {
      method: "CASH",
      requestId: payment.requestId,
      amountReceived: payment.amountReceived,
      changeDue: payment.changeDue,
      paidAt: payment.paidAt,
      paidBy: payment.paidBy,
    },
  };
}
export async function reviewCashPayment(
  shopId: string,
  orderId: string,
  signal: AbortSignal,
) {
  const { data } = await api.get<CashPaymentReviewResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}/cash-payment`,
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  return parseCash(data, shopId, orderId);
}
export async function lookupCashPayment(
  shopId: string,
  rawNumber: string,
  signal: AbortSignal,
) {
  const orderNumber = rawNumber.trim().toUpperCase();
  if (!isOrderNumber(orderNumber))
    throw new Error("Enter a valid order number, such as ORD-000006.");
  const { data } = await api.post<CashPaymentReviewResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/cash-payment/lookup-number`,
    { orderNumber },
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  if (
    data?.order?.orderNumber !== orderNumber ||
    typeof data?.order?.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      data.order.id,
    )
  )
    throw new Error("The order lookup response could not be verified.");
  return parseCash(data, shopId, data.order.id);
}
export async function collectCashPayment(
  shopId: string,
  orderId: string,
  dto: CashPaymentRequest,
  signal: AbortSignal,
) {
  const { data } = await api.post<CashPaymentReviewResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}/cash-payment`,
    {
      requestId: dto.requestId,
      reviewVersion: dto.reviewVersion,
      amountReceived: dto.amountReceived,
    },
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  const saved = parseCash(data, shopId, orderId);
  if (
    !saved.payment ||
    saved.payment.requestId !== dto.requestId ||
    saved.payment.amountReceived !== dto.amountReceived
  )
    throw new Error(
      "The payment result could not be confirmed. Refresh before collecting cash again.",
    );
  return saved;
}
