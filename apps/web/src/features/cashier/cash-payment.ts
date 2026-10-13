import {
  cashAmountCents,
  PAYMENT_REFERENCE_PATTERN,
  isSafeOtherPaymentText,
  isSafeManualCardReference,
  type CashPaymentRequest,
  type CashPaymentReviewResponse,
  type ManualGcashPaymentRequest,
  type ManualCardPaymentRequest,
  type OtherPaymentRequest,
  type CreatePaymentRequest,
  PREPARATION_STATUSES,
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
  if (
    data.queue != null &&
    (order.paymentStatus !== "PAID" ||
      !payment ||
      !PREPARATION_STATUSES.includes(data.queue.status) ||
      typeof data.queue.queuedAt !== "string" ||
      !Number.isFinite(Date.parse(data.queue.queuedAt)) ||
      Date.parse(data.queue.queuedAt) < Date.parse(payment.paidAt))
  )
    throw new Error(
      "The saved preparation state could not be verified. Refresh the order.",
    );
  if (order.paymentStatus === "UNPAID") {
    if (payment !== null)
      throw new Error(
        "The saved payment state could not be verified. Refresh before collecting cash.",
      );
    return { order, payment: null };
  }
  if (
    !payment ||
    !["CASH", "GCASH_MANUAL", "CARD_MANUAL", "OTHER"].includes(
      payment.method,
    ) ||
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
    cashAmountCents(payment.changeDue) === null ||
    (payment.method !== "CASH" && payment.changeDue !== "0.00") ||
    (payment.method === "CARD_MANUAL" &&
      !isSafeManualCardReference(payment.reference)) ||
    (payment.reference != null &&
      (payment.method === "CASH" ||
        typeof payment.reference !== "string" ||
        !payment.reference.trim() ||
        !PAYMENT_REFERENCE_PATTERN.test(payment.reference))) ||
    (payment.method === "OTHER"
      ? !isSafeOtherPaymentText(payment.description, 80) ||
        !payment.description.trim() ||
        (payment.reference != null &&
          !isSafeOtherPaymentText(payment.reference))
      : payment.description != null)
  )
    throw new Error(
      "The saved payment receipt could not be verified. Ask the shop owner for help.",
    );
  return {
    order,
    ...(data.queue !== undefined ? { queue: data.queue } : {}),
    payment: {
      method: payment.method,
      requestId: payment.requestId,
      amountReceived: payment.amountReceived,
      changeDue: payment.changeDue,
      paidAt: payment.paidAt,
      paidBy: payment.paidBy,
      reference: payment.reference ?? null,
      description: payment.description ?? null,
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
    saved.payment.method !== "CASH" ||
    saved.payment.requestId !== dto.requestId ||
    saved.payment.amountReceived !== dto.amountReceived
  )
    throw new Error(
      "The payment result could not be confirmed. Refresh before collecting cash again.",
    );
  return saved;
}

export async function recordManualGcashPayment(
  shopId: string,
  orderId: string,
  dto: ManualGcashPaymentRequest,
  signal: AbortSignal,
) {
  return recordManualPayment(shopId, orderId, dto, signal, "GCASH_MANUAL");
}

export async function recordManualCardPayment(
  shopId: string,
  orderId: string,
  dto: ManualCardPaymentRequest,
  signal: AbortSignal,
) {
  return recordManualPayment(shopId, orderId, dto, signal, "CARD_MANUAL");
}

export async function recordOtherPayment(
  shopId: string,
  orderId: string,
  dto: OtherPaymentRequest,
  signal: AbortSignal,
) {
  return recordManualPayment(shopId, orderId, dto, signal, "OTHER");
}

export async function createPayment(
  shopId: string,
  orderId: string,
  dto: CreatePaymentRequest,
  signal: AbortSignal,
) {
  if (dto.method === "CARD_MANUAL" && !isSafeManualCardReference(dto.reference))
    throw new Error(
      "Use a terminal receipt reference without card numbers or security details.",
    );
  const { data } = await api.post<CashPaymentReviewResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}/create-payment`,
    dto,
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  const saved = parseCash(data, shopId, orderId);
  if (
    !saved.payment ||
    saved.payment.requestId !== dto.requestId ||
    saved.payment.method !== dto.method ||
    (dto.method === "CASH" &&
      saved.payment.amountReceived !== dto.amountReceived) ||
    (saved.payment.reference ?? null) !== (dto.reference?.trim() || null) ||
    (saved.payment.description ?? null) !== (dto.description?.trim() || null)
  )
    throw new Error(
      "The confirmation/payment result could not be verified. Refresh the saved state before processing again.",
    );
  return saved;
}

async function recordManualPayment(
  shopId: string,
  orderId: string,
  dto: ManualGcashPaymentRequest | OtherPaymentRequest,
  signal: AbortSignal,
  method: "GCASH_MANUAL" | "CARD_MANUAL" | "OTHER",
) {
  if (method === "CARD_MANUAL" && !isSafeManualCardReference(dto.reference))
    throw new Error(
      "Use a terminal receipt reference without card numbers or security details.",
    );
  const route =
    method === "OTHER"
      ? "other-payment"
      : method === "CARD_MANUAL"
        ? "card-manual-payment"
        : "gcash-manual-payment";
  const { data } = await api.post<CashPaymentReviewResponse>(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}/${route}`,
    {
      requestId: dto.requestId,
      reviewVersion: dto.reviewVersion,
      receivedConfirmed: dto.receivedConfirmed,
      ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
      ...("description" in dto ? { description: dto.description } : {}),
    },
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  const saved = parseCash(data, shopId, orderId);
  if (
    !saved.payment ||
    saved.payment.method !== method ||
    saved.payment.requestId !== dto.requestId ||
    (saved.payment.reference ?? null) !== (dto.reference?.trim() || null) ||
    (method === "OTHER" &&
      saved.payment.description !==
        ("description" in dto ? dto.description.trim() : null))
  )
    throw new Error(
      "The payment result could not be confirmed. Refresh before recording payment again.",
    );
  return saved;
}
