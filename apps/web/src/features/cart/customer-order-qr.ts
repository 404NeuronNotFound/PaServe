import type { CustomerOrderResponse } from "@paserve/contracts";
import QRCode from "qrcode";
import { parseOrderQrToken } from "../orders/order-qr-reference";
import { isOrderNumber } from "./order-receipt-fields";

export type CustomerOrderQr = {
  qrToken: string;
  expiresAt: number;
  orderNumber: string;
};
// Credentials survive SPA navigation only. Never read or write browser storage.
const tokens = new Map<string, CustomerOrderQr>();
const key = (shopSlug: string, orderId: string) =>
  JSON.stringify([shopSlug, orderId]);
export function captureCustomerOrderQr(
  shopSlug: string,
  order: CustomerOrderResponse["order"],
) {
  const entryKey = key(shopSlug, order.id);
  tokens.delete(entryKey);
  if (
    typeof order.qrToken !== "string" ||
    typeof order.qrTokenExpiresAt !== "string" ||
    !isOrderNumber(order.orderNumber)
  )
    return;
  const reference = parseOrderQrToken(order.qrToken);
  if (
    !reference ||
    reference.orderId !== order.id ||
    reference.expiresAt !== Date.parse(order.qrTokenExpiresAt) ||
    reference.expiresAt <= Date.now()
  )
    return;
  // Bound memory use and discard expired credentials before adding this receipt.
  for (const [entry, token] of tokens)
    if (token.expiresAt <= Date.now()) tokens.delete(entry);
  if (tokens.size >= 20) tokens.delete(tokens.keys().next().value!);
  tokens.set(entryKey, {
    qrToken: reference.qrToken,
    expiresAt: reference.expiresAt,
    orderNumber: order.orderNumber,
  });
}
export function readCustomerOrderQr(
  shopSlug: string,
  orderId: string,
): CustomerOrderQr | null {
  const entryKey = key(shopSlug, orderId);
  const value = tokens.get(entryKey);
  if (!value || value.expiresAt <= Date.now()) {
    tokens.delete(entryKey);
    return null;
  }
  return { ...value };
}
export function clearCustomerOrderQrs() {
  tokens.clear();
}

/** Deterministic local rendering: token only, no order details or external URL. */
export async function createCustomerQrImage(qrToken: string): Promise<string> {
  if (!parseOrderQrToken(qrToken)) throw new Error("Order QR unavailable.");
  const svg = await QRCode.toString(qrToken, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
