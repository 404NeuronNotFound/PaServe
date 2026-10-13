import type { VerifyOrderQrResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import "../auth/api/session";
import { AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";
import { parseCashierItems } from "./order-items";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/i;
export type OrderQrReference = {
  shopId: string;
  orderId: string;
  qrToken: string;
};
/** QR contents are the signed order token itself. Claims only route a read;
 * The active shop comes from staff context; the backend resolves the order ID.
 * Parsing never supplies trusted order details or a destination URL. */
export function parseOrderQr(raw: string): OrderQrReference | null {
  const qrToken = raw.trim();
  if (
    qrToken.length > 1024 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(qrToken)
  )
    return null;
  try {
    const encoded = qrToken
      .split(".")[0]
      .replaceAll("-", "+")
      .replaceAll("_", "/");
    const bytes = Uint8Array.from(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
      (char) => char.charCodeAt(0),
    );
    const claims = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !claims ||
      claims.v !== 1 ||
      claims.purpose !== "order-receipt" ||
      typeof claims.shopId !== "string" ||
      !uuid.test(claims.shopId) ||
      typeof claims.orderId !== "string" ||
      !uuid.test(claims.orderId) ||
      typeof claims.nonce !== "string" ||
      !uuid.test(claims.nonce) ||
      typeof claims.exp !== "number" ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= 0
    )
      return null;
    return { shopId: claims.shopId, orderId: claims.orderId, qrToken };
  } catch {
    return null;
  }
}
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
  if (
    !data ||
    data.verified !== true ||
    data.order?.id !== reference.orderId ||
    data.order.shopId !== shopId ||
    !isOrderNumber(data.order.orderNumber) ||
    !["DINE_IN", "TAKEOUT"].includes(data.order.mode) ||
    data.order.currency !== "PHP" ||
    !isOrderTotal(data.order.totalPrice) ||
    typeof data.order.status !== "string" ||
    !data.order.status ||
    typeof data.order.paymentStatus !== "string" ||
    !data.order.paymentStatus ||
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
  return { ...data.order, items };
}
