import { create } from "zustand";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";

export interface CartItem extends ProductSelectionQuoteResponse {
  lineId: string;
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
  add: (slug: string, quote: ProductSelectionQuoteResponse) => void;
  remove: (slug: string, lineId: string) => void;
}
// Session memory only. Quotes are snapshots; checkout must revalidate them later.
export const useCart = create<CartState>((set) => ({
  shops: {},
  add: (slug, quote) =>
    set((state) => ({
      shops: {
        ...state.shops,
        [slug]: [
          ...cartItemsForShop(state.shops, slug),
          { ...quote, lineId: crypto.randomUUID() },
        ],
      },
    })),
  remove: (slug, lineId) =>
    set((state) => ({
      shops: {
        ...state.shops,
        [slug]: cartItemsForShop(state.shops, slug).filter(
          (item) => item.lineId !== lineId,
        ),
      },
    })),
}));

export function sumPrices(prices: string[], quantity = 1): string {
  const cents =
    prices.reduce((sum, price) => {
      const [whole, fractional = ""] = price.split(".");
      return sum + BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
    }, 0n) * BigInt(quantity);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
