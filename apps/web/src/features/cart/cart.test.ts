import { beforeEach, expect, it } from "vitest";
import {
  cartItemsForShop,
  cartItemCount,
  cartEstimatedSubtotal,
  cartVariantKey,
  cartCheckoutLines,
  cartSelectionRequest,
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

it("keeps only cart-owned snapshots when API responses contain extra server data", () => {
  const response = {
    ...quote,
    menu: { products: ["unselected-product"] },
    owner: { email: "owner@example.test" },
    inventory: { remaining: 20 },
    variants: [{
      id: "large", optionGroupId: "size", name: "Large",
      priceAdjustment: "0.10", isDefault: false,
      product: { description: "Full catalog record" },
    }],
    addOns: [{
      id: "milk", name: "Milk", priceAdjustment: "0.20",
      assignments: ["other-product"],
    }],
  };
  const preview = { ...createCartPricePreview(response), serverDebug: "not cart data" };
  useCart.getState().add("cafe", response, preview);
  const original = useCart.getState().shops.cafe[0];
  expect(original).not.toHaveProperty("menu");
  expect(original).not.toHaveProperty("owner");
  expect(original).not.toHaveProperty("inventory");
  expect(original.variants[0]).not.toHaveProperty("product");
  expect(original.addOns[0]).not.toHaveProperty("assignments");
  expect(original.pricePreview).not.toHaveProperty("serverDebug");
  expect(original).toMatchObject({
    productId: quote.productId,
    variants: [{ id: "large", name: "Large", priceAdjustment: "0.10" }],
    addOns: [{ id: "milk", name: "Milk", priceAdjustment: "0.20" }],
  });
  const update = { ...response, quantity: 2, unitPrice: "1.30", totalPrice: "2.60" };
  expect(useCart.getState().updateQuantity("cafe", original, update, createCartPricePreview(update))).toBe(true);
  const updated = useCart.getState().shops.cafe[0];
  expect(updated).not.toHaveProperty("menu");
  expect(updated.variants[0]).not.toHaveProperty("product");
  expect(updated.addOns[0]).not.toHaveProperty("assignments");
  expect(updated.lineId).toBe(original.lineId);
});

it("derives counts and subtotals from shop lines rather than storing duplicate state", () => {
  expect(cartItemCount(EMPTY_CART)).toBe(0);
  expect(cartEstimatedSubtotal(EMPTY_CART)).toBe("0.00");
  useCart.getState().add("cafe", { ...quote, quantity: 2, totalPrice: "2.00" });
  useCart.getState().add("cafe", { ...quote, quantity: 3, unitPrice: "1.01", totalPrice: "3.03" });
  useCart.getState().add("other", { ...quote, quantity: 99, totalPrice: "99.00" });
  const items = cartItemsForShop(useCart.getState().shops, "cafe");
  expect(cartItemCount(items)).toBe(5);
  expect(cartEstimatedSubtotal(items)).toBe("5.03");
  useCart.getState().remove("cafe", items[0].lineId);
  const remaining = cartItemsForShop(useCart.getState().shops, "cafe");
  expect(cartItemCount(remaining)).toBe(3);
  expect(cartEstimatedSubtotal(remaining)).toBe("3.03");
  expect(useCart.getState()).not.toHaveProperty("subtotal");
  expect(useCart.getState()).not.toHaveProperty("count");
});

it("calculates an exact estimate from base, all variant/add-on adjustments and quantity", () => {
  const selection = {
    ...quote,
    basePrice: "120.01",
    quantity: 3,
    variants: [
      { id: "large", name: "Large", optionGroupId: "size", isDefault: false, priceAdjustment: "30.10" },
      { id: "iced", name: "Iced", optionGroupId: "temperature", isDefault: false, priceAdjustment: "0.00" },
    ],
    addOns: [
      { id: "milk", name: "Milk", priceAdjustment: "25.20" },
      { id: "free", name: "Free", priceAdjustment: "0.00" },
    ],
  };
  expect(createCartPricePreview(selection)).toEqual({
    source: "client", currency: "PHP", basePrice: "120.01",
    variantAdjustment: "30.10", addOnAdjustment: "25.20",
    unitPrice: "175.31", totalPrice: "525.93", quantity: 3,
  });
  expect(createCartPricePreview({ ...quote, basePrice: "0.01", quantity: 99 }).totalPrice).toBe("0.99");
  expect(createCartPricePreview({ ...quote, basePrice: "0.00", quantity: 99 }).totalPrice).toBe("0.00");
});

it("identifies variant selections by product and IDs, independent of price, names and order", () => {
  const variants: ProductSelectionQuoteResponse["variants"] = [
    { id: "large", name: "Large", optionGroupId: "size", isDefault: false, priceAdjustment: "0.10" },
    { id: "iced", name: "Iced", optionGroupId: "temperature", isDefault: false, priceAdjustment: "0.00" },
  ];
  const configured = { ...quote, variants };
  const key = cartVariantKey(configured);
  expect(cartVariantKey({
    ...configured,
    variants: [...variants].reverse().map((variant) => ({ ...variant, name: "Renamed", priceAdjustment: "9.99" })),
  })).toBe(key);
  expect(cartVariantKey({ ...configured, productId: "tea" })).not.toBe(key);
  expect(cartVariantKey({ ...configured, variants: [variants[0]] })).not.toBe(key);
  expect(cartVariantKey({ ...configured, variants: [] })).not.toBe(key);
});

it("stores distinct variant identities while keeping identical additions independently removable", () => {
  const regular = {
    ...quote,
    variants: [{ id: "regular", name: "Regular", optionGroupId: "size", isDefault: true, priceAdjustment: "0.00" }],
  };
  const large = {
    ...quote,
    variants: [{ ...regular.variants[0], id: "large", name: "Large", isDefault: false, priceAdjustment: "0.10" }],
  };
  useCart.getState().add("cafe", regular);
  useCart.getState().add("cafe", large);
  useCart.getState().add("cafe", regular);
  const [first, second, duplicate] = useCart.getState().shops.cafe;
  expect(first.variantKey).not.toBe(second.variantKey);
  expect(first.variantKey).toBe(duplicate.variantKey);
  expect(first.lineId).not.toBe(duplicate.lineId);
  useCart.getState().remove("cafe", first.lineId);
  expect(useCart.getState().shops.cafe).toEqual([second, duplicate]);
});

it("preserves variant identity during repricing and rejects substituted variants", () => {
  const configured = {
    ...quote,
    variants: [{ id: "large", name: "Large", optionGroupId: "size", isDefault: false, priceAdjustment: "0.10" }],
  };
  useCart.getState().add("cafe", configured);
  const original = useCart.getState().shops.cafe[0];
  const updated = {
    ...configured, quantity: 2, unitPrice: "1.20", totalPrice: "2.40",
    variants: [{ ...configured.variants[0], name: "Large cup", priceAdjustment: "0.20" }],
  };
  expect(useCart.getState().updateQuantity("cafe", original, updated, createCartPricePreview(updated))).toBe(true);
  const current = useCart.getState().shops.cafe[0];
  expect(current).toMatchObject({
    lineId: original.lineId, variantKey: original.variantKey, quantity: 2,
    variants: updated.variants, totalPrice: "2.40",
  });
  const before = useCart.getState();
  for (const variants of [[], [{ ...updated.variants[0], id: "regular" }]]) {
    const substituted = { ...updated, variants, quantity: 3 };
    expect(useCart.getState().updateQuantity("cafe", current, substituted, createCartPricePreview(substituted))).toBe(false);
    expect(useCart.getState()).toBe(before);
  }
});
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

it("retains paid/free add-ons per line and serializes this shop's selections without prices", () => {
  const configured = {
    ...quote,
    notes: "Less ice",
    quantity: 2,
    unitPrice: "1.20",
    totalPrice: "2.40",
    addOns: [
      { id: "milk", name: "Milk", priceAdjustment: "0.20" },
      { id: "free", name: "Free extra", priceAdjustment: "0.00" },
    ],
  };
  useCart.getState().add("cafe", configured, createCartPricePreview(configured));
  useCart.getState().add("cafe", quote);
  useCart.getState().add("other", { ...quote, productId: "tea" });
  const before = useCart.getState();
  const payload = cartCheckoutLines(before.shops, "cafe");
  expect(payload).toEqual([
    { productId: "coffee", variantIds: [], addOnIds: ["milk", "free"], quantity: 2, notes: "Less ice" },
    { productId: "coffee", variantIds: [], addOnIds: [], quantity: 1 },
  ]);
  expect(cartSelectionRequest(before.shops.cafe[0], 3)).toEqual({
    variantIds: [], addOnIds: ["milk", "free"], quantity: 3, notes: "Less ice",
  });
  payload[0].addOnIds.pop();
  expect(before.shops.cafe[0].addOns).toEqual(configured.addOns);
  expect(cartCheckoutLines(before.shops, "missing")).toEqual([]);
});

it("retains selected add-on IDs during repricing regardless of option order or renamed prices", () => {
  const configured = {
    ...quote,
    addOns: [
      { id: "milk", name: "Milk", priceAdjustment: "0.20" },
      { id: "free", name: "Free extra", priceAdjustment: "0.00" },
    ],
  };
  useCart.getState().add("cafe", configured);
  const original = useCart.getState().shops.cafe[0];
  const repriced = {
    ...configured, quantity: 3, unitPrice: "1.30", totalPrice: "3.90",
    addOns: [...configured.addOns].reverse().map((addOn) => ({
      ...addOn, name: `Updated ${addOn.name}`, priceAdjustment: addOn.id === "milk" ? "0.30" : "0.00",
    })),
  };
  expect(useCart.getState().updateQuantity("cafe", original, repriced, createCartPricePreview(repriced))).toBe(true);
  const current = useCart.getState().shops.cafe[0];
  expect(current.addOns).toEqual(repriced.addOns);
  expect(cartSelectionRequest(current).addOnIds).toEqual(["free", "milk"]);
  const before = useCart.getState();
  for (const addOns of [[], [repriced.addOns[0]], [{ ...repriced.addOns[0], id: "foreign" }, repriced.addOns[1]], [...repriced.addOns, { id: "extra", name: "Unselected", priceAdjustment: "1.00" }]]) {
    const changed = { ...repriced, addOns };
    expect(useCart.getState().updateQuantity("cafe", current, changed, createCartPricePreview(changed))).toBe(false);
    expect(useCart.getState()).toBe(before);
  }
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
    useCart.getState().add("other", { ...quote, unitPrice: "2.00", totalPrice: "2.00" });
    const items = cartItemsForShop(useCart.getState().shops, slug);
    expect(items).toHaveLength(1);
    expect(items[0].totalPrice).toBe("1.00");
    expect(Object.hasOwn(useCart.getState().shops, slug)).toBe(true);
    useCart.getState().remove(slug, items[0].lineId);
    expect(cartItemsForShop(useCart.getState().shops, slug)).toEqual([]);
    expect(cartItemsForShop(useCart.getState().shops, "other")).toHaveLength(1);
  },
);
