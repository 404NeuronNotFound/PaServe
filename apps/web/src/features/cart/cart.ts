import { create } from "zustand";
import {
  CUSTOMER_NOTE_MAX_LENGTH,
  CUSTOMER_NOTE_PATTERN,
  normalizeCustomerNote,
} from "@paserve/contracts";
import type {
  ProductSelectionQuoteResponse,
  ProductSelectionRequest,
  CustomerCheckoutRequest,
} from "@paserve/contracts";
import {
  useCustomerTables,
  customerTableCode,
  isPublicTableContext,
  type CustomerTableState,
} from "../shops/customer-table";
import {
  browserCartStorage,
  parseCartLine,
  readCartStorage,
  writeCartStorage,
  type CartStorage,
} from "./cart-storage";

export interface CartSelection {
  productId: string;
  quantity: number;
  notes?: string;
}

// Small display snapshots for selected options, never the full product/menu cache.
export type CartVariant = Pick<
  ProductSelectionQuoteResponse["variants"][number],
  "id" | "optionGroupId" | "name" | "priceAdjustment" | "isDefault"
>;
export type CartAddOn = Pick<
  ProductSelectionQuoteResponse["addOns"][number],
  "id" | "name" | "priceAdjustment"
>;

export interface CartItem extends CartSelection {
  lineId: string;
  variantKey: string;
  productName: string;
  currency: ProductSelectionQuoteResponse["currency"];
  basePrice: string;
  unitPrice: string;
  totalPrice: string;
  variants: CartVariant[];
  addOns: CartAddOn[];
  pricePreview: CartPricePreview | null;
}

export const PRICE_PREVIEW_NOTICE =
  "Prices are estimates. Final prices will be recalculated when you submit your order.";

// Independent of option order, display names, current prices, and quantity.
export function cartVariantKey(
  selection: Pick<ProductSelectionQuoteResponse, "productId" | "variants">,
): string {
  return JSON.stringify([
    selection.productId,
    selection.variants.map((variant) => variant.id).sort(),
  ]);
}

// Submit IDs and customer input only; saved names/prices are display snapshots.
export function cartSelectionRequest(
  item: CartItem,
  quantity = item.quantity,
): ProductSelectionRequest {
  return {
    variantIds: item.variants.map((variant) => variant.id),
    addOnIds: item.addOns.map((addOn) => addOn.id),
    quantity,
    ...(item.notes ? { notes: item.notes } : {}),
  };
}

// Selection payload for checkout; the server revalidates each line.
export function cartCheckoutLines(
  shops: Record<string, CartItem[]>,
  slug: string,
): (ProductSelectionRequest & { productId: string })[] {
  return cartItemsForShop(shops, slug).map((item) => ({
    productId: item.productId,
    ...cartSelectionRequest(item),
  }));
}

export function cartCheckoutRequest(
  shops: Record<string, CartItem[]>,
  slug: string,
  tables: Pick<
    CustomerTableState,
    "codes" | "resolved"
  > = useCustomerTables.getState(),
): CustomerCheckoutRequest {
  const code = customerTableCode(tables.codes, slug);
  const table = Object.hasOwn(tables.resolved, slug)
    ? tables.resolved[slug]
    : undefined;
  if (
    (code !== undefined || table !== undefined) &&
    (!isPublicTableContext(table) ||
      table.shopSlug !== slug ||
      table.code !== code)
  )
    throw new Error("Resolve the table link before preparing checkout.");
  return {
    ...(code !== undefined
      ? {
          mode: "DINE_IN" as const,
          tableCode: code,
          ...(table?.checkoutToken ? { tableToken: table.checkoutToken } : {}),
        }
      : {}),
    items: cartCheckoutLines(shops, slug),
  };
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

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((count, item) => count + item.quantity, 0);
}

export function cartEstimatedSubtotal(items: CartItem[]): string {
  return sumPrices(items.map((item) => item.totalPrice));
}

function cartLineSnapshot(
  quote: ProductSelectionQuoteResponse,
  lineId: string,
  pricePreview?: CartPricePreview,
): CartItem {
  // Explicit projection prevents extra API fields from entering client state.
  return {
    lineId,
    variantKey: cartVariantKey(quote),
    productId: quote.productId,
    productName: quote.productName,
    currency: quote.currency,
    quantity: quote.quantity,
    ...(quote.notes ? { notes: quote.notes } : {}),
    basePrice: quote.basePrice,
    unitPrice: quote.unitPrice,
    totalPrice: quote.totalPrice,
    variants: quote.variants.map((variant) => ({
      id: variant.id,
      optionGroupId: variant.optionGroupId,
      name: variant.name,
      priceAdjustment: variant.priceAdjustment,
      isDefault: variant.isDefault,
    })),
    addOns: quote.addOns.map((addOn) => ({
      id: addOn.id,
      name: addOn.name,
      priceAdjustment: addOn.priceAdjustment,
    })),
    pricePreview: pricePreview
      ? {
          source: "client",
          currency: pricePreview.currency,
          basePrice: pricePreview.basePrice,
          variantAdjustment: pricePreview.variantAdjustment,
          addOnAdjustment: pricePreview.addOnAdjustment,
          unitPrice: pricePreview.unitPrice,
          totalPrice: pricePreview.totalPrice,
          quantity: pricePreview.quantity,
        }
      : null,
  };
}

// Use the same validation for API snapshots and reloads: accepted lines must
// remain safe to render, submit and restore even when a response is malformed.
function validatedCartLine(
  quote: ProductSelectionQuoteResponse,
  lineId: string,
  pricePreview?: CartPricePreview,
): CartItem | null {
  try {
    return parseCartLine(cartLineSnapshot(quote, lineId, pricePreview));
  } catch {
    return null;
  }
}
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
  ) => boolean;
  remove: (slug: string, lineId: string) => void;
  updateNotes: (slug: string, expected: CartItem, notes: string) => boolean;
  updateQuantity: (
    slug: string,
    expected: CartItem,
    quote: ProductSelectionQuoteResponse,
    pricePreview: CartPricePreview,
  ) => boolean;
}
// Only cart snapshots persist. Checkout must revalidate them before ordering.
export function createCartStore(
  storage: CartStorage | null = browserCartStorage(),
) {
  const store = create<CartState>((set) => ({
    shops: readCartStorage(storage),
    add: (slug, quote, pricePreview) => {
      const item = validatedCartLine(quote, crypto.randomUUID(), pricePreview);
      if (!item) return false;
      set((state) => ({
        shops: {
          ...state.shops,
          [slug]: [...cartItemsForShop(state.shops, slug), item],
        },
      }));
      return true;
    },
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
    updateNotes: (slug, expected, draft) => {
      if (
        draft.length > CUSTOMER_NOTE_MAX_LENGTH ||
        !CUSTOMER_NOTE_PATTERN.test(draft)
      ) {
        return false;
      }
      const notes = normalizeCustomerNote(draft);
      let updated = false;
      set((state) => {
        const items = cartItemsForShop(state.shops, slug);
        if (!items.includes(expected)) return state;
        updated = true;
        if (expected.notes === notes) return state;
        const replacement = { ...expected };
        delete replacement.notes;
        if (notes) replacement.notes = notes;
        return {
          shops: {
            ...state.shops,
            [slug]: items.map((item) =>
              item === expected ? replacement : item,
            ),
          },
        };
      });
      return updated;
    },
    updateQuantity: (slug, expected, quote, pricePreview) => {
      const replacement = validatedCartLine(
        quote,
        expected.lineId,
        pricePreview,
      );
      if (!replacement) return false;
      let updated = false;
      set((state) => {
        const items = cartItemsForShop(state.shops, slug);
        if (
          !items.includes(expected) ||
          replacement.productId !== expected.productId ||
          replacement.variantKey !== expected.variantKey ||
          replacement.notes !== expected.notes ||
          JSON.stringify(replacement.addOns.map((addOn) => addOn.id).sort()) !==
            JSON.stringify(expected.addOns.map((addOn) => addOn.id).sort()) ||
          !Number.isInteger(quote.quantity) ||
          quote.quantity < 1 ||
          quote.quantity > 99 ||
          quote.quantity !== pricePreview.quantity
        )
          return state;
        updated = true;
        return {
          shops: {
            ...state.shops,
            [slug]: items.map((item) =>
              item === expected ? replacement : item,
            ),
          },
        };
      });
      return updated;
    },
  }));
  store.subscribe((state, previous) => {
    const slugs = new Set([
      ...Object.keys(previous.shops),
      ...Object.keys(state.shops),
    ]);
    for (const slug of slugs) {
      const items = cartItemsForShop(state.shops, slug);
      if (items !== cartItemsForShop(previous.shops, slug)) {
        writeCartStorage(storage, slug, items);
      }
    }
  });
  return store;
}

export const useCart = createCartStore();

export function sumPrices(prices: string[], quantity = 1): string {
  const cents =
    prices.reduce((sum, price) => {
      const [whole, fractional = ""] = price.split(".");
      return sum + BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
    }, 0n) * BigInt(quantity);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
