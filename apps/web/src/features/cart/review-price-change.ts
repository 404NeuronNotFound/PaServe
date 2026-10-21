import { cartEstimatedSubtotal, cartSelectionRequest, sumPrices, type CartItem } from "./cart";
import { parseCartLine } from "./cart-storage";

/** Accept only updated prices for exactly the selections the customer reviewed. */
export function reviewPriceChange<T extends { items: CartItem[] }>(review: T, value: unknown): T | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.code !== "ORDER_PRICE_CHANGED" || data.currency !== "PHP" ||
    typeof data.totalPrice !== "string" || !Array.isArray(data.items) || data.items.length !== review.items.length) return null;
  const items = review.items.map((original, index) => {
    const quote: unknown = (data.items as unknown[])[index];
    if (!quote || typeof quote !== "object" || Array.isArray(quote)) return null;
    const item = parseCartLine({ ...quote, lineId: original.lineId, pricePreview: null });
    if (!item || item.productId !== original.productId) return null;
    if (sumPrices([item.basePrice, ...item.variants.map((option) => option.priceAdjustment),
      ...item.addOns.map((option) => option.priceAdjustment)]) !== item.unitPrice) return null;
    const normalize = (line: typeof original) => {
      const selection = cartSelectionRequest(line);
      return { ...selection, variantIds: [...selection.variantIds].sort(), addOnIds: [...selection.addOnIds].sort() };
    };
    return JSON.stringify(normalize(item)) === JSON.stringify(normalize(original)) ? item : null;
  });
  if (items.some((item) => !item)) return null;
  const valid = items.filter((item) => item !== null);
  return cartEstimatedSubtotal(valid) === data.totalPrice ? { ...review, items: valid } : null;
}
