import { create } from "zustand";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";

export interface CartItem extends ProductSelectionQuoteResponse {
  lineId: string;
  pricePreview: CartPricePreview | null;
}

// The estimate shown before submission; quoted prices remain authoritative.
export interface CartPricePreview {
  source: "client";
  currency: ProductSelectionQuoteResponse["currency"];
  basePrice: string;
  variantAdjustment: string;
  addOnAdjustment: string;
  unitPrice: string;
  totalPrice: string;
  quantity: number;
}

export function createCartPricePreview(
  selection: Pick<
    ProductSelectionQuoteResponse,
    "currency" | "basePrice" | "variants" | "addOns" | "quantity"
  >,
): CartPricePreview {
  const variantAdjustment = sumPrices(
    selection.variants.map((variant) => variant.priceAdjustment),
  );
  const addOnAdjustment = sumPrices(
    selection.addOns.map((addOn) => addOn.priceAdjustment),
  );
  const prices = [selection.basePrice, variantAdjustment, addOnAdjustment];
  return {
    source: "client",
    currency: selection.currency,
    basePrice: selection.basePrice,
    variantAdjustment,
    addOnAdjustment,
    unitPrice: sumPrices(prices),
    totalPrice: sumPrices(prices, selection.quantity),
    quantity: selection.quantity,
  };
}
export const EMPTY_CART: CartItem[] = [];
export function cartItemsForShop(
  shops: Record<string, CartItem[]>,
  slug: string,
): CartItem[] {
  return Object.hasOwn(shops, slug) ? shops[slug] : EMPTY_CART;
}
interface CartState {
  shops: Record<string, CartItem[]>;
  add: (
    slug: string,
    quote: ProductSelectionQuoteResponse,
    pricePreview?: CartPricePreview,
  ) => void;
  remove: (slug: string, lineId: string) => void;
  updateQuantity: (
    slug: string,
    expected: CartItem,
    quote: ProductSelectionQuoteResponse,
    pricePreview: CartPricePreview,
  ) => boolean;
}
// Session memory only. Quotes are snapshots; checkout must revalidate them later.
export const useCart = create<CartState>((set) => ({
  shops: {},
  add: (slug, quote, pricePreview) =>
    set((state) => ({
      shops: {
        ...state.shops,
        [slug]: [
          ...cartItemsForShop(state.shops, slug),
          {
            ...quote,
            variants: quote.variants.map((variant) => ({ ...variant })),
            addOns: quote.addOns.map((addOn) => ({ ...addOn })),
            lineId: crypto.randomUUID(),
            pricePreview: pricePreview ? { ...pricePreview } : null,
          },
        ],
      },
    })),
  remove: (slug, lineId) =>
    set((state) => {
      const items = cartItemsForShop(state.shops, slug);
      if (!items.some((item) => item.lineId === lineId)) return state;
      return {
        shops: {
          ...state.shops,
          [slug]: items.filter((item) => item.lineId !== lineId),
        },
      };
    }),
  updateQuantity: (slug, expected, quote, pricePreview) => {
    let updated = false;
    set((state) => {
      const items = cartItemsForShop(state.shops, slug);
      if (
        !items.includes(expected) ||
        quote.productId !== expected.productId ||
        !Number.isInteger(quote.quantity) ||
        quote.quantity < 1 || quote.quantity > 99 ||
        quote.quantity !== pricePreview.quantity
      ) return state;
      updated = true;
      return {
        shops: {
          ...state.shops,
          [slug]: items.map((item) => item === expected ? {
            ...quote,
            lineId: expected.lineId,
            variants: quote.variants.map((variant) => ({ ...variant })),
            addOns: quote.addOns.map((addOn) => ({ ...addOn })),
            pricePreview: { ...pricePreview },
          } : item),
        },
      };
    });
    return updated;
  },
}));

export function sumPrices(prices: string[], quantity = 1): string {
  const cents =
    prices.reduce((sum, price) => {
      const [whole, fractional = ""] = price.split(".");
      return sum + BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
    }, 0n) * BigInt(quantity);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
