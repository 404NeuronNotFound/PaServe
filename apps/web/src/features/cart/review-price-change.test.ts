import { expect, it } from "vitest";
import { createCartStore } from "./cart";
import { reviewPriceChange } from "./review-price-change";

const quote = { productId: "coffee", productName: "Coffee", currency: "PHP" as const,
  basePrice: "1.00", unitPrice: "1.00", totalPrice: "2.00", quantity: 2, variants: [], addOns: [] };
function fixture() {
  const store = createCartStore(null);
  store.getState().add("cafe", quote);
  const review = { items: store.getState().shops.cafe, fingerprint: "original", mode: "TAKEOUT" as const };
  const changed = { code: "ORDER_PRICE_CHANGED", currency: "PHP", totalPrice: "3.00",
    items: [{ ...quote, basePrice: "1.50", unitPrice: "1.50", totalPrice: "3.00" }] };
  return { review, changed };
}
it("accepts validated new prices while preserving the reviewed selection identity and original cart", () => {
  const { review, changed } = fixture();
  const updated = reviewPriceChange(review, changed)!;
  expect(updated.fingerprint).toBe("original");
  expect(updated.items[0].lineId).toBe(review.items[0].lineId);
  expect(updated.items[0].totalPrice).toBe("3.00");
  expect(review.items[0].totalPrice).toBe("2.00");
});
it.each([
  { productId: "another" }, { quantity: 1 }, { notes: "Changed selection" },
  { unitPrice: "0.01" }, { basePrice: "9.00" }, { currency: "USD" },
])("rejects a changed selection or invalid price arithmetic: %j", (mutation) => {
  const { review, changed } = fixture();
  changed.items[0] = { ...changed.items[0], ...mutation } as typeof changed.items[number];
  expect(reviewPriceChange(review, changed)).toBeNull();
});
it("rejects a response with a mismatched order total", () => {
  const { review, changed } = fixture();
  expect(reviewPriceChange(review, { ...changed, totalPrice: "0.01" })).toBeNull();
});
