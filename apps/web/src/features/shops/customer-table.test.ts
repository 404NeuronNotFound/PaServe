import { expect, it } from "vitest";
import {
  createCustomerTableStore,
  CUSTOMER_TABLE_STORAGE_KEY,
} from "./customer-table";
import {
  cartCheckoutRequest,
  createCartStore,
  createCartPricePreview,
} from "../cart/cart";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";

const table = { shopSlug: "cafe", code: "T12", number: "Patio 4" };
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
it("remembers only shop-scoped public codes and requires server resolution after refresh", () => {
  const storage = memoryStorage();
  const store = createCustomerTableStore(storage);
  store.getState().setResolved(table);
  store.getState().setResolved({ ...table, shopSlug: "other", code: "T3" });
  expect(JSON.parse(storage.getItem(CUSTOMER_TABLE_STORAGE_KEY)!)).toEqual({
    cafe: "T12",
    other: "T3",
  });
  const refreshed = createCustomerTableStore(storage);
  expect(refreshed.getState().codes).toEqual({ cafe: "T12", other: "T3" });
  expect(refreshed.getState().resolved).toEqual({});
  expect(() => cartCheckoutRequest({}, "cafe", refreshed.getState())).toThrow(
    /Resolve/,
  );
  refreshed.getState().setResolved({ ...table, number: "New label" });
  expect(cartCheckoutRequest({}, "cafe", refreshed.getState())).toEqual({
    tableCode: "T12",
    items: [],
  });
});
it("includes the table automatically with selections, quantities and notes, without display prices or IDs", () => {
  const tables = createCustomerTableStore(null);
  tables.getState().setResolved(table);
  const cart = createCartStore(null);
  const quote: ProductSelectionQuoteResponse = {
    productId: "coffee",
    productName: "Coffee",
    currency: "PHP",
    basePrice: "10.00",
    unitPrice: "10.00",
    totalPrice: "20.00",
    quantity: 2,
    notes: "Less ice",
    variants: [],
    addOns: [],
  };
  cart.getState().add("cafe", quote, createCartPricePreview(quote));
  expect(
    cartCheckoutRequest(cart.getState().shops, "cafe", tables.getState()),
  ).toEqual({
    tableCode: "T12",
    items: [
      {
        productId: "coffee",
        quantity: 2,
        notes: "Less ice",
        variantIds: [],
        addOnIds: [],
      },
    ],
  });
  expect(
    cartCheckoutRequest(cart.getState().shops, "other", tables.getState()),
  ).toEqual({ items: [] });
});
it("a new scan replaces the same shop's table and prevents checkout while unresolved", () => {
  const store = createCustomerTableStore(null);
  store.getState().setResolved(table);
  store.getState().beginResolution("cafe", "T13");
  expect(() => cartCheckoutRequest({}, "cafe", store.getState())).toThrow();
  store.getState().setResolved({ ...table, code: "T13", number: "13" });
  expect(cartCheckoutRequest({}, "cafe", store.getState()).tableCode).toBe(
    "T13",
  );
  store.getState().clear("cafe");
  expect(store.getState().codes).toEqual({});
  expect(store.getState().resolved).toEqual({});
});
it.each([
  "broken json",
  '["T12"]',
  '{"__proto__":"T12","cafe":"../private","other":42}',
  '{"cafe":"75992537-5d60-4d22-8e1e-60a114644681"}',
])("ignores corrupt/unsafe stored hints %s", (saved) => {
  expect(
    createCustomerTableStore({
      getItem: () => saved,
      setItem: () => {},
    }).getState().codes,
  ).toEqual({});
});
it("works when session storage is unavailable", () => {
  const store = createCustomerTableStore({
    getItem: () => {
      throw Error();
    },
    setItem: () => {
      throw Error();
    },
  });
  store.getState().setResolved(table);
  expect(cartCheckoutRequest({}, "cafe", store.getState()).tableCode).toBe(
    "T12",
  );
});
it("rejects mismatched shop or code in prepared checkout context", () => {
  expect(() =>
    cartCheckoutRequest({}, "cafe", {
      codes: { cafe: "T12" },
      resolved: { cafe: { ...table, shopSlug: "other" } },
    }),
  ).toThrow();
  expect(() =>
    cartCheckoutRequest({}, "cafe", {
      codes: { cafe: "T12" },
      resolved: { cafe: { ...table, code: "T13" } },
    }),
  ).toThrow();
});
