import { beforeEach, expect, it } from "vitest";
import {
  cartItemsForShop,
  createCartPricePreview,
  EMPTY_CART,
  useCart,
} from "./cart";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";

beforeEach(() => useCart.setState({ shops: {} }));
const quote: ProductSelectionQuoteResponse = {
  productId: "coffee",
  productName: "Coffee",
  currency: "PHP",
  basePrice: "1.00",
  unitPrice: "1.00",
  totalPrice: "1.00",
  quantity: 1,
  variants: [],
  addOns: [],
};
it("keeps separate configured additions and independent quote/preview snapshots", () => {
  const configured = {
    ...quote,
    quantity: 2,
    notes: "Less ice",
    unitPrice: "1.32",
    totalPrice: "2.64",
    variants: [{
      id: "large",
      name: "Large",
      optionGroupId: "size",
      isDefault: false,
      priceAdjustment: "0.10",
    }],
    addOns: [
      { id: "milk", name: "Milk", priceAdjustment: "0.20" },
      { id: "free", name: "Free extra", priceAdjustment: "0.00" },
    ],
  };
  const preview = createCartPricePreview(configured);
  useCart.getState().add("cafe", configured, preview);
  useCart.getState().add("cafe", configured, preview);
  configured.variants[0].name = "Changed";
  configured.addOns[0].priceAdjustment = "9.99";
  preview.totalPrice = "99.00";

  const items = cartItemsForShop(useCart.getState().shops, "cafe");
  expect(items).toHaveLength(2);
  expect(items[0].lineId).not.toBe(items[1].lineId);
  expect(items[0]).toMatchObject({
    quantity: 2,
    notes: "Less ice",
    unitPrice: "1.32",
    totalPrice: "2.64",
    variants: [{ name: "Large" }],
    addOns: [{ priceAdjustment: "0.20" }, { priceAdjustment: "0.00" }],
    pricePreview: {
      source: "client",
      currency: "PHP",
      basePrice: "1.00",
      variantAdjustment: "0.10",
      addOnAdjustment: "0.20",
      unitPrice: "1.30",
      totalPrice: "2.60",
      quantity: 2,
    },
  });
  expect(items[1]).toEqual({ ...items[0], lineId: items[1].lineId });
  expect(cartItemsForShop(useCart.getState().shops, "other")).toEqual([]);
});

it("does not invent client preview metadata for a quote-only addition", () => {
  useCart.getState().add("cafe", quote);
  expect(useCart.getState().shops.cafe[0].pricePreview).toBeNull();
});

it("removes only the selected configured duplicate, preserving other lines and shops", () => {
  const configured: ProductSelectionQuoteResponse = {
    ...quote,
    quantity: 3,
    unitPrice: "1.30",
    totalPrice: "3.90",
    notes: "Less ice",
    variants: [{
      id: "large", name: "Large", optionGroupId: "size",
      isDefault: false, priceAdjustment: "0.10",
    }],
    addOns: [{ id: "milk", name: "Milk", priceAdjustment: "0.20" }],
  };
  const preview = createCartPricePreview(configured);
  useCart.getState().add("cafe", configured, preview);
  useCart.getState().add("cafe", configured, preview);
  useCart.getState().add("cafe", { ...quote, notes: "Hot" });
  useCart.getState().add("other", configured, preview);
  const before = useCart.getState();
  const [first, removed, last] = before.shops.cafe;
  const saved = structuredClone(before.shops);

  useCart.getState().remove("cafe", removed.lineId);
  const after = useCart.getState();
  expect(after.shops.cafe).toEqual([saved.cafe[0], saved.cafe[2]]);
  expect(after.shops.cafe[0]).toBe(first);
  expect(after.shops.cafe[1]).toBe(last);
  expect(after.shops.other).toBe(before.shops.other);
  expect(after.shops.other).toEqual(saved.other);
  expect(before.shops).toEqual(saved);

  useCart.getState().remove("cafe", removed.lineId);
  expect(useCart.getState()).toBe(after);
});

it("ignores missing lines, unknown shops and another shop's line ID", () => {
  useCart.getState().add("cafe", quote);
  useCart.getState().add("other", quote);
  const before = useCart.getState();
  useCart.getState().remove("cafe", "missing");
  useCart.getState().remove("missing-shop", before.shops.cafe[0].lineId);
  useCart.getState().remove("cafe", before.shops.other[0].lineId);
  expect(useCart.getState()).toBe(before);
  expect(Object.hasOwn(useCart.getState().shops, "missing-shop")).toBe(false);
});

it.each(["constructor", "__proto__", "toString"])(
  "isolates cart operations for the object-property slug %s",
  (slug) => {
    expect(cartItemsForShop(useCart.getState().shops, slug)).toBe(EMPTY_CART);
    useCart.getState().remove(slug, "missing");
    useCart.getState().add(slug, quote);
    useCart.getState().add("other", { ...quote, totalPrice: "2.00" });
    const items = cartItemsForShop(useCart.getState().shops, slug);
    expect(items).toHaveLength(1);
    expect(items[0].totalPrice).toBe("1.00");
    expect(Object.hasOwn(useCart.getState().shops, slug)).toBe(true);
    useCart.getState().remove(slug, items[0].lineId);
    expect(cartItemsForShop(useCart.getState().shops, slug)).toEqual([]);
    expect(cartItemsForShop(useCart.getState().shops, "other")).toHaveLength(1);
  },
);
