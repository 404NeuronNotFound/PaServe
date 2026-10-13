import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
import { parseCartLine } from "../cart/cart-storage";
import { isOrderTotal } from "../cart/order-receipt-fields";
import { sumPrices } from "../cart/cart";

/** Validate saved arithmetic without repricing against the current menu. */
export function parseCashierItems(
  value: unknown,
  total: string,
): ProductSelectionQuoteResponse[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 100) return null;
  const items: ProductSelectionQuoteResponse[] = [];
  for (let index = 0; index < value.length; index++) {
    const raw: unknown = value[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = parseCartLine({ ...raw, lineId: `cashier-${index}` });
    if (
      !item ||
      ![item.basePrice, item.unitPrice, item.totalPrice].every(isOrderTotal) ||
      sumPrices([
        item.basePrice,
        ...item.variants.map((variant) => variant.priceAdjustment),
        ...item.addOns.map((addOn) => addOn.priceAdjustment),
      ]) !== item.unitPrice
    )
      return null;
    const savedNotes = (raw as Record<string, unknown>).notes;
    items.push({
      productId: item.productId,
      productName: item.productName,
      currency: item.currency,
      quantity: item.quantity,
      basePrice: item.basePrice,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      variants: item.variants,
      addOns: item.addOns,
      ...(typeof savedNotes === "string" && savedNotes
        ? { notes: savedNotes }
        : {}),
    });
  }
  return sumPrices(items.map((item) => item.totalPrice)) === total
    ? items
    : null;
}
