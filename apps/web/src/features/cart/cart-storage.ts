import {
  isValidCustomerNote,
  isValidOrderQuantity,
  ORDER_INPUT_LIMITS,
  ADD_ON_LIMITS,
  normalizeCustomerNote,
} from "@paserve/contracts";
import type { CartItem, CartPricePreview } from "./cart";

export const CART_STORAGE_PREFIX = "paserve-cart:";
export const CART_STORAGE_VERSION = 1;
export type CartStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export function cartStorageKey(slug: string): string {
  return `${CART_STORAGE_PREFIX}${encodeURIComponent(slug)}`;
}

export function browserCartStorage(): CartStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000;
}
function money(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d{0,15})\.\d{2}$/.test(value);
}
function cents(value: string): bigint {
  return BigInt(value.replace(".", ""));
}
function quantity(value: unknown): value is number {
  return isValidOrderQuantity(value);
}

function preview(value: unknown, count: number): CartPricePreview | null {
  if (!record(value) || value.source !== "client" || value.currency !== "PHP" || value.quantity !== count ||
    !money(value.basePrice) || !money(value.variantAdjustment) || !money(value.addOnAdjustment) ||
    !money(value.unitPrice) || !money(value.totalPrice)) return null;
  if (cents(value.basePrice) + cents(value.variantAdjustment) + cents(value.addOnAdjustment) !== cents(value.unitPrice) ||
    cents(value.unitPrice) * BigInt(count) !== cents(value.totalPrice)) return null;
  return {
    source: "client", currency: "PHP", quantity: count,
    basePrice: value.basePrice, variantAdjustment: value.variantAdjustment,
    addOnAdjustment: value.addOnAdjustment, unitPrice: value.unitPrice, totalPrice: value.totalPrice,
  };
}

export function parseCartLine(value: unknown): CartItem | null {
  if (!record(value) || !text(value.lineId) || !text(value.productId) || !text(value.productName) ||
    value.currency !== "PHP" || !quantity(value.quantity) ||
    !money(value.basePrice) || !money(value.unitPrice) || !money(value.totalPrice) ||
    !Array.isArray(value.variants) || value.variants.length > ORDER_INPUT_LIMITS.variantsMax ||
    !Array.isArray(value.addOns) || value.addOns.length > ADD_ON_LIMITS.selectionMax) return null;
  if (cents(value.unitPrice) * BigInt(value.quantity) !== cents(value.totalPrice)) return null;
  if (value.notes !== undefined && !isValidCustomerNote(value.notes)) return null;
  const variants: CartItem["variants"] = [];
  const addOns: CartItem["addOns"] = [];
  for (const variant of value.variants) {
    if (!record(variant) || !text(variant.id) || !text(variant.name) ||
      !(variant.optionGroupId === null || text(variant.optionGroupId)) ||
      typeof variant.isDefault !== "boolean" || !money(variant.priceAdjustment)) return null;
    variants.push({ id: variant.id, name: variant.name, optionGroupId: variant.optionGroupId,
      isDefault: variant.isDefault, priceAdjustment: variant.priceAdjustment });
  }
  for (const addOn of value.addOns) {
    if (!record(addOn) || !text(addOn.id) || !text(addOn.name) || !money(addOn.priceAdjustment)) return null;
    addOns.push({ id: addOn.id, name: addOn.name, priceAdjustment: addOn.priceAdjustment });
  }
  if (new Set(variants.map((variant) => variant.id)).size !== variants.length ||
    new Set(variants.map((variant) => variant.optionGroupId)).size !== variants.length ||
    new Set(addOns.map((addOn) => addOn.id)).size !== addOns.length) return null;
  const notes = normalizeCustomerNote(typeof value.notes === "string" ? value.notes : "");
  return {
    lineId: value.lineId, productId: value.productId, productName: value.productName,
    variantKey: JSON.stringify([value.productId, variants.map((variant) => variant.id).sort()]),
    currency: "PHP", quantity: value.quantity, ...(notes ? { notes } : {}),
    basePrice: value.basePrice, unitPrice: value.unitPrice, totalPrice: value.totalPrice,
    variants, addOns, pricePreview: preview(value.pricePreview, value.quantity),
  };
}

function cleanLines(values: unknown[]): CartItem[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const item = parseCartLine(value);
    if (!item || seen.has(item.lineId)) return [];
    seen.add(item.lineId);
    return [item];
  });
}

export function readCartStorage(storage: CartStorage | null): Record<string, CartItem[]> {
  if (!storage) return {};
  const entries: [string, CartItem[]][] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(CART_STORAGE_PREFIX)) continue;
      try {
        const slug = decodeURIComponent(key.slice(CART_STORAGE_PREFIX.length));
        if (!text(slug) || cartStorageKey(slug) !== key) continue;
        const raw = storage.getItem(key);
        if (!raw || raw.length > 2_000_000) continue;
        const saved: unknown = JSON.parse(raw);
        if (!record(saved) || saved.version !== CART_STORAGE_VERSION || saved.shopSlug !== slug || !Array.isArray(saved.items)) continue;
        const items = cleanLines(saved.items);
        if (items.length) entries.push([slug, items]);
      } catch {
        // A corrupt/unreadable shop must not prevent restoring other shops.
      }
    }
  } catch {
    // Browsers may block storage entirely; the cart remains usable in memory.
  }
  return Object.fromEntries(entries);
}

export function writeCartStorage(storage: CartStorage | null, slug: string, items: CartItem[]): void {
  if (!storage) return;
  try {
    const key = cartStorageKey(slug);
    const saved = cleanLines(items);
    if (!saved.length) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ version: CART_STORAGE_VERSION, shopSlug: slug, items: saved }));
  } catch {
    // Quota/private-mode failures must not roll back a successful cart action.
  }
}
