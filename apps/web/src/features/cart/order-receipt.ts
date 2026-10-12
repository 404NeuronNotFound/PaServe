import type {
  CustomerOrderResponse,
  PublicMenuResponse,
} from "@paserve/contracts";
import { createPendingOrderStorage } from "./pending-orders";

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
      typeof value.shopName !== "string" ||
      !value.shopName.trim() ||
      !(
        value.orderNumber === null ||
        (typeof value.orderNumber === "string" &&
          /^ORD-\d{6,19}$/.test(value.orderNumber) &&
          BigInt(value.orderNumber.slice(4)) > 0n)
      ) ||
      value.status !== "PENDING_CONFIRMATION" ||
      value.currency !== "PHP" ||
      typeof value.totalPrice !== "string" ||
      !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(value.totalPrice) ||
      !(value.mode === "TAKEOUT"
        ? value.table === null
        : value.mode === "DINE_IN" &&
          value.table &&
          typeof value.table.code === "string" &&
          !!value.table.code &&
          typeof value.table.number === "string" &&
          !!value.table.number.trim())
    )
      return null;
    return value as OrderReceipt;
  } catch {
    return null;
  }
}
