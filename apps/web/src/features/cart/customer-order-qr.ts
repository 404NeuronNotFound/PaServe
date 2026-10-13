import type { CustomerOrderResponse } from "@paserve/contracts";
import QRCode from "qrcode";
import { parseOrderQrToken } from "../orders/order-qr-reference";
import { isOrderNumber } from "./order-receipt-fields";

export type CustomerOrderQr = {
  qrToken: string;
  expiresAt: number;
  orderNumber: string;
};
// Receipt references survive reloads in this tab. These never grant staff access.
const tokens = new Map<string, CustomerOrderQr>();
const key = (shopSlug: string, orderId: string) =>
  JSON.stringify([shopSlug, orderId]);
const storageKey = (shopSlug: string, orderId: string) =>
  `paserve-customer-qr:v1:${encodeURIComponent(shopSlug)}:${encodeURIComponent(orderId)}`;
function remove(shopSlug: string, orderId: string) {
  tokens.delete(key(shopSlug, orderId));
  try {
    sessionStorage.removeItem(storageKey(shopSlug, orderId));
  } catch {
    /* Memory remains usable when storage is blocked. */
  }
}
function valid(value: unknown, orderId: string): value is CustomerOrderQr {
  if (!value || typeof value !== "object") return false;
  const entry = value as CustomerOrderQr;
  if (
    typeof entry.qrToken !== "string" ||
    !isOrderNumber(entry.orderNumber) ||
    typeof entry.expiresAt !== "number"
  )
    return false;
  const reference = parseOrderQrToken(entry.qrToken);
  return (
    !!reference &&
    reference.orderId === orderId &&
    reference.expiresAt === entry.expiresAt &&
    entry.expiresAt > Date.now()
  );
}
export function captureCustomerOrderQr(
  shopSlug: string,
  order: CustomerOrderResponse["order"],
) {
  const entryKey = key(shopSlug, order.id);
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
  const saved = {
    qrToken: reference.qrToken,
    expiresAt: reference.expiresAt,
    orderNumber: order.orderNumber,
  };
  tokens.set(entryKey, saved);
  try {
    sessionStorage.setItem(
      storageKey(shopSlug, order.id),
      JSON.stringify({ version: 1, shopSlug, orderId: order.id, ...saved }),
    );
  } catch {
    /* Keep the QR for the current page even without storage. */
  }
}
export function readCustomerOrderQr(
  shopSlug: string,
  orderId: string,
): CustomerOrderQr | null {
  const entryKey = key(shopSlug, orderId);
  let value: unknown = tokens.get(entryKey);
  if (!value) {
    try {
      const raw = sessionStorage.getItem(storageKey(shopSlug, orderId));
      if (raw && raw.length <= 2048) {
        const saved = JSON.parse(raw);
        if (
          saved.version === 1 &&
          saved.shopSlug === shopSlug &&
          saved.orderId === orderId
        )
          value = saved;
      }
    } catch {
      /* Missing or blocked storage shows the existing fallback. */
    }
  }
  if (!valid(value, orderId)) {
    remove(shopSlug, orderId);
    return null;
  }
  const restored = {
    qrToken: value.qrToken,
    expiresAt: value.expiresAt,
    orderNumber: value.orderNumber,
  };
  tokens.set(entryKey, restored);
  return restored;
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
