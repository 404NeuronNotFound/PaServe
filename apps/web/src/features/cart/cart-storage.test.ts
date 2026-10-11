import { afterEach, expect, it, vi } from "vitest";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
import {
  cartCheckoutLines, cartEstimatedSubtotal, cartItemCount, cartItemsForShop,
  createCartPricePreview, createCartStore,
} from "./cart";
import {
  browserCartStorage, CART_STORAGE_VERSION, cartStorageKey,
  type CartStorage,
} from "./cart-storage";

afterEach(() => vi.restoreAllMocks());
function memoryStorage(): CartStorage {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: vi.fn((key, value) => { entries.set(key, value); }),
    removeItem: vi.fn((key) => { entries.delete(key); }),
  };
}
const quote: ProductSelectionQuoteResponse = {
  productId: "coffee", productName: "Coffee", currency: "PHP",
  basePrice: "120.01", unitPrice: "175.31", totalPrice: "350.62",
  quantity: 2, notes: "Less ice",
  variants: [{ id: "large", name: "Large", optionGroupId: "size", isDefault: false, priceAdjustment: "30.10" }],
  addOns: [
    { id: "milk", name: "Milk", priceAdjustment: "25.20" },
    { id: "free", name: "No sugar", priceAdjustment: "0.00" },
  ],
};
function seed(storage: CartStorage, slug = "cafe") {
  const store = createCartStore(storage);
  store.getState().add(slug, quote, createCartPricePreview(quote));
  return store;
}

it("restores configured lines, edited quantities, notes and exact totals after a fresh store startup", () => {
  const storage = memoryStorage();
  const original = seed(storage);
  original.getState().add("cafe", quote, createCartPricePreview(quote));
  const first = original.getState().shops.cafe[0];
  const changed = { ...quote, quantity: 3, totalPrice: "525.93" };
  expect(original.getState().updateQuantity("cafe", first, changed, createCartPricePreview(changed))).toBe(true);
  expect(original.getState().updateNotes("cafe", original.getState().shops.cafe[0], "  Extra hot\r\nNo sugar  ")).toBe(true);
  const beforeReload = structuredClone(original.getState().shops.cafe);
  const reloaded = createCartStore(storage);
  const restored = reloaded.getState().shops.cafe;
  expect(restored).toEqual(beforeReload);
  expect(restored[0].lineId).not.toBe(restored[1].lineId);
  expect(cartItemCount(restored)).toBe(5);
  expect(cartEstimatedSubtotal(restored)).toBe("876.55");
  expect(cartCheckoutLines(reloaded.getState().shops, "cafe")[0]).toEqual({
    productId: "coffee", variantIds: ["large"], addOnIds: ["milk", "free"],
    quantity: 3, notes: "Extra hot\nNo sugar",
  });
  const saved = JSON.parse(storage.getItem(cartStorageKey("cafe"))!);
  expect(saved.version).toBe(CART_STORAGE_VERSION);
  expect(saved.shopSlug).toBe("cafe");
});

it.each(["cafe", "constructor", "__proto__", "toString"])("keeps %s isolated from another shop on disk and after reload", (slug) => {
  const storage = memoryStorage();
  const store = seed(storage, slug);
  store.getState().add("other", { ...quote, productId: "tea", productName: "Tea" });
  const otherSaved = storage.getItem(cartStorageKey("other"));
  expect(storage.getItem(cartStorageKey(slug))).not.toBeNull();
  const first = cartItemsForShop(store.getState().shops, slug)[0];
  store.getState().remove(slug, first.lineId);
  expect(storage.getItem(cartStorageKey(slug))).toBeNull();
  expect(storage.getItem(cartStorageKey("other"))).toBe(otherSaved);
  const reloaded = createCartStore(storage);
  expect(cartItemsForShop(reloaded.getState().shops, slug)).toEqual([]);
  expect(reloaded.getState().shops.other[0].productId).toBe("tea");
});

it("persists only whitelisted cart fields and leaves auth/appearance storage untouched", () => {
  const storage = memoryStorage();
  storage.setItem("auth-token", "unrelated-token-fixture");
  storage.setItem("paserve-appearance", "night");
  const store = createCartStore(storage);
  const response = {
    ...quote, accessToken: "must-not-persist", owner: { email: "private@example.test" },
    addOns: quote.addOns.map((addOn) => ({ ...addOn, internalCost: "1.00" })),
  };
  store.getState().add("cafe", response);
  const saved = storage.getItem(cartStorageKey("cafe"))!;
  expect(saved).not.toContain("must-not-persist");
  expect(saved).not.toContain("owner");
  expect(saved).not.toContain("internalCost");
  expect(saved).not.toContain("updateNotes");
  expect(storage.getItem("auth-token")).toBe("unrelated-token-fixture");
  expect(storage.getItem("paserve-appearance")).toBe("night");
  expect(Object.keys(createCartStore(storage).getState().shops)).toEqual(["cafe"]);
});

it.each(["broken-json", "future-version", "wrong-shop", "wrong-shape"])("ignores %s records without affecting valid shops", (problem) => {
  const storage = memoryStorage();
  seed(storage, "other");
  const envelope = { version: 1, shopSlug: "cafe", items: [] as unknown };
  if (problem === "future-version") envelope.version = 99;
  if (problem === "wrong-shop") envelope.shopSlug = "other";
  if (problem === "wrong-shape") envelope.items = {};
  storage.setItem(cartStorageKey("cafe"), problem === "broken-json" ? "{" : JSON.stringify(envelope));
  const restored = createCartStore(storage).getState();
  expect(cartItemsForShop(restored.shops, "cafe")).toEqual([]);
  expect(restored.shops.other[0].notes).toBe("Less ice");
});

it.each(["quantity", "money", "subtotal", "notes", "addon", "variant"])("drops an invalid %s line while restoring its valid neighbor", (problem) => {
  const storage = memoryStorage();
  seed(storage);
  const envelope = JSON.parse(storage.getItem(cartStorageKey("cafe"))!);
  const invalid = structuredClone(envelope.items[0]);
  invalid.lineId = "invalid-line";
  if (problem === "quantity") invalid.quantity = 0;
  if (problem === "money") invalid.unitPrice = "1e6";
  if (problem === "subtotal") invalid.totalPrice = "0.00";
  if (problem === "notes") invalid.notes = "bad\u0000note";
  if (problem === "addon") invalid.addOns.push(invalid.addOns[0]);
  if (problem === "variant") invalid.variants.push(invalid.variants[0]);
  envelope.items.push(invalid);
  storage.setItem(cartStorageKey("cafe"), JSON.stringify(envelope));
  expect(createCartStore(storage).getState().shops.cafe).toEqual([envelope.items[0]]);
});

it("strips injected fields, rebuilds variant identity and rejects duplicate line IDs", () => {
  const storage = memoryStorage();
  seed(storage);
  const envelope = JSON.parse(storage.getItem(cartStorageKey("cafe"))!);
  const item = envelope.items[0];
  item.variantKey = "forged";
  item.accessToken = "injected";
  item.addOns[0].privateCost = "1.00";
  item.pricePreview.internal = "ignored";
  envelope.items.push(structuredClone(item));
  storage.setItem(cartStorageKey("cafe"), JSON.stringify(envelope));
  const restored = createCartStore(storage).getState().shops.cafe;
  expect(restored).toHaveLength(1);
  expect(restored[0].variantKey).toBe(JSON.stringify(["coffee", ["large"]]));
  expect(restored[0]).not.toHaveProperty("accessToken");
  expect(restored[0].addOns[0]).not.toHaveProperty("privateCost");
  expect(restored[0].pricePreview).not.toHaveProperty("internal");
});

it("persists cleared notes and prevents removed lines from returning after reload", () => {
  const storage = memoryStorage();
  const store = seed(storage);
  store.getState().updateNotes("cafe", store.getState().shops.cafe[0], "   ");
  const restored = createCartStore(storage);
  expect(restored.getState().shops.cafe[0]).not.toHaveProperty("notes");
  expect(cartCheckoutLines(restored.getState().shops, "cafe")[0]).not.toHaveProperty("notes");
  restored.getState().remove("cafe", restored.getState().shops.cafe[0].lineId);
  expect(createCartStore(storage).getState().shops).toEqual({});
});

it("keeps actions usable when storage reads, writes, removals or browser access fail", () => {
  const storage = memoryStorage();
  storage.setItem(cartStorageKey("cafe"), "{}");
  vi.spyOn(storage, "key").mockImplementation(() => { throw new Error("Denied"); });
  vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("Quota"); });
  vi.spyOn(storage, "removeItem").mockImplementation(() => { throw new Error("Denied"); });
  const store = createCartStore(storage);
  store.getState().add("cafe", quote);
  const item = store.getState().shops.cafe[0];
  expect(store.getState().updateNotes("cafe", item, "Hot")).toBe(true);
  expect(() => store.getState().remove("cafe", item.lineId)).not.toThrow();
  expect(store.getState().shops.cafe).toEqual([]);
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("Blocked"); });
  expect(browserCartStorage()).toBeNull();
  expect(() => createCartStore()).not.toThrow();
});
