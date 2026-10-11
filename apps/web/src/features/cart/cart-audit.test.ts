import { expect, it } from "vitest";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
import { cartCheckoutLines, cartEstimatedSubtotal, createCartPricePreview, createCartStore } from "./cart";

const quote: ProductSelectionQuoteResponse = {
  productId: "coffee", productName: "Coffee", currency: "PHP",
  basePrice: "10.00", unitPrice: "12.00", totalPrice: "24.00", quantity: 2,
  variants: [{ id: "large", name: "Large", optionGroupId: "size", isDefault: false, priceAdjustment: "1.00" }],
  addOns: [{ id: "milk", name: "Milk", priceAdjustment: "1.00" }],
  notes: "Less ice",
};

it.each([
  { quantity: 0 }, { quantity: 100 }, { quantity: 1.5 },
  { unitPrice: "NaN" }, { totalPrice: "1.00" }, { currency: "USD" },
  { notes: "bad\u0000note" }, { notes: "x".repeat(301) },
  { variants: null }, { addOns: [...quote.addOns, ...quote.addOns] },
])("rejects malformed additions without affecting saved selections: %j", (patch) => {
  const store = createCartStore(null);
  store.getState().add("cafe", quote);
  const before = store.getState();
  expect(() => store.getState().add("cafe", { ...quote, ...patch } as ProductSelectionQuoteResponse)).not.toThrow();
  expect(store.getState()).toBe(before);
});

it.each([{ unitPrice: "NaN" }, { totalPrice: "0.00" }, { currency: "USD" }, { variants: null }])(
  "rejects malformed repricing without losing the original line: %j", (patch) => {
    const store = createCartStore(null);
    store.getState().add("cafe", quote);
    const before = store.getState();
    const replacement = { ...quote, quantity: 3, totalPrice: "36.00", ...patch } as ProductSelectionQuoteResponse;
    expect(store.getState().updateQuantity("cafe", before.shops.cafe[0], replacement, createCartPricePreview({ ...quote, quantity: 3 }))).toBe(false);
    expect(store.getState()).toBe(before);
    expect(cartEstimatedSubtotal(before.shops.cafe)).toBe("24.00");
  },
);

it("normalizes initial notes so subsequent quantity changes and checkout agree", () => {
  const store = createCartStore(null);
  store.getState().add("cafe", { ...quote, notes: "  Less ice\r\nNo sugar  " });
  const item = store.getState().shops.cafe[0];
  expect(item.notes).toBe("Less ice\nNo sugar");
  const updated = { ...quote, notes: "Less ice\nNo sugar", quantity: 3, totalPrice: "36.00" };
  expect(store.getState().updateQuantity("cafe", item, updated, createCartPricePreview(updated))).toBe(true);
  expect(cartCheckoutLines(store.getState().shops, "cafe")[0].notes).toBe("Less ice\nNo sugar");
});
