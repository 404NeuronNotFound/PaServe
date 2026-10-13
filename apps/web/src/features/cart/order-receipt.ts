import type {
  CustomerOrderResponse,
  PublicMenuResponse,
} from "@paserve/contracts";
import { createPendingOrderStorage } from "./pending-orders";
import { isPublicTableContext } from "../shops/customer-table";
import { captureCustomerOrderQr } from "./customer-order-qr";
import {
  isOrderNumber,
  isOrderReceiptId,
  isOrderTotal,
} from "./order-receipt-fields";

/** Display snapshot only; never an authorization source or a live status lookup. */
export interface OrderReceipt {
  shopSlug: string;
  shopName: string;
  primaryColor?: string | null;
  accentColor?: string | null;
  id: string;
  orderNumber: string | null;
  mode: "DINE_IN" | "TAKEOUT";
  table: { code: string; number: string } | null;
  status: "PENDING_CONFIRMATION";
  currency: "PHP";
  /** Exact saved server total; never derived from current cart or menu prices. */
  totalPrice: string;
}

export const orderReceipts = createPendingOrderStorage(
  () => window.sessionStorage,
);
const key = (shopSlug: string, orderId: string) =>
  `paserve-order-receipt:v1:${encodeURIComponent(shopSlug)}:${encodeURIComponent(orderId)}`;

/** Called only after checkout validates the server response. Omit bearer credentials. */
export function saveOrderReceipt(
  shopSlug: string,
  shopName: string,
  order: CustomerOrderResponse["order"],
  branding: Pick<
    PublicMenuResponse["shop"],
    "primaryColor" | "accentColor"
  > = {},
) {
  captureCustomerOrderQr(shopSlug, order);
  const receipt: OrderReceipt = {
    shopSlug,
    shopName,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
    id: order.id,
    orderNumber: order.orderNumber ?? null,
    mode: order.mode,
    table:
      order.mode === "DINE_IN"
        ? { code: order.table.code, number: order.table.number }
        : null,
    status: order.status,
    currency: order.currency,
    totalPrice: order.totalPrice,
  };
  orderReceipts.write(key(shopSlug, order.id), receipt);
}

export function readOrderReceipt(
  shopSlug: string,
  orderId: string,
): OrderReceipt | null {
  try {
    const value = JSON.parse(
      orderReceipts.read(key(shopSlug, orderId)) ?? "null",
    );
    // Upgrade older display-only receipts; server confirmations require the new status.
    if (value && typeof value === "object" && value.status === "PENDING")
      value.status = "PENDING_CONFIRMATION";
    // Invalid display colors fall back to the shared menu palette, not a lost receipt.
    if (value && typeof value === "object") {
      if (typeof value.primaryColor !== "string") value.primaryColor = null;
      if (typeof value.accentColor !== "string") value.accentColor = null;
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.shopSlug !== shopSlug ||
      value.id !== orderId ||
      !isOrderReceiptId(value.id) ||
      typeof value.shopName !== "string" ||
      !value.shopName.trim() ||
      !(value.orderNumber === null || isOrderNumber(value.orderNumber)) ||
      value.status !== "PENDING_CONFIRMATION" ||
      value.currency !== "PHP" ||
      !isOrderTotal(value.totalPrice) ||
      !(value.mode === "TAKEOUT"
        ? value.table === null
        : value.mode === "DINE_IN" &&
          value.table &&
          isPublicTableContext({
            shopSlug,
            code: value.table.code,
            number: value.table.number,
          }))
    )
      return null;
    // Restore only display fields; legacy or tampered storage must not surface
    // credentials, notes, or other request data through the receipt reader.
    return {
      shopSlug,
      shopName: value.shopName,
      primaryColor: value.primaryColor,
      accentColor: value.accentColor,
      id: value.id,
      orderNumber: value.orderNumber,
      mode: value.mode,
      table:
        value.mode === "DINE_IN"
          ? { code: value.table.code, number: value.table.number }
          : null,
      status: "PENDING_CONFIRMATION",
      currency: "PHP",
      totalPrice: value.totalPrice,
    };
  } catch {
    return null;
  }
}
