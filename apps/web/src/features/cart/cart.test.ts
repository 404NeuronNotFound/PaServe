import { beforeEach, expect, it } from "vitest";
import { cartItemsForShop, EMPTY_CART, useCart } from "./cart";
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
