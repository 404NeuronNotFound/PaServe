import { expect, it } from "vitest";
import type { CreateTakeoutOrderRequest } from "@paserve/contracts";
import { isCreatedOrderResponse } from "./order-confirmation";

const request: CreateTakeoutOrderRequest = {
  mode: "TAKEOUT",
  requestId: "request-a",
  items: [
    {
      productId: "coffee",
      quantity: 2,
      variantIds: ["large"],
      addOnIds: ["milk"],
      notes: "Less ice",
    },
  ],
};
const line = {
  productId: "coffee",
  productName: "Coffee",
  currency: "PHP",
  basePrice: "20.03",
  unitPrice: "28.25",
  totalPrice: "56.50",
  quantity: 2,
  notes: "Less ice",
  variants: [
    {
      id: "large",
      optionGroupId: "size",
      name: "Large",
      priceAdjustment: "6.07",
      isDefault: false,
    },
  ],
  addOns: [{ id: "milk", name: "Oat milk", priceAdjustment: "2.15" }],
};
const order = {
  id: "order-a",
  mode: "TAKEOUT",
  status: "PENDING",
  table: null,
  currency: "PHP",
  totalPrice: "56.50",
  items: [line],
  createdAt: "2026-10-12T00:00:00.000Z",
};
it("accepts a pending order with matching selections and consistent server-calculated prices", () => {
  expect(isCreatedOrderResponse({ order }, request, "cafe")).toBe(true);
});
it("accepts an authoritative subtotal consistent with the server-priced lines", () => {
  expect(
    isCreatedOrderResponse(
      { order: { ...order, subtotalPrice: "56.50" } },
      request,
      "cafe",
    ),
  ).toBe(true);
});
it.each(["55.00", "56.5", 56.5, null, "NaN"])(
  "rejects inconsistent or invalid subtotal %j",
  (subtotalPrice) => {
    expect(
      isCreatedOrderResponse(
        { order: { ...order, subtotalPrice } },
        request,
        "cafe",
      ),
    ).toBe(false);
  },
);
it.each([
  null,
  {},
  { order: null },
  { order: { ...order, status: "PLACED" } },
  { order: { ...order, items: [] } },
  { order: { ...order, totalPrice: "55.00" } },
  {
    order: { ...order, table: { shopSlug: "cafe", code: "T12", number: "12" } },
  },
  { order: { ...order, createdAt: "invalid" } },
  { order: { ...order, items: [{ ...line, productId: "other" }] } },
  {
    order: {
      ...order,
      items: [{ ...line, quantity: 1, totalPrice: "28.25" }],
      totalPrice: "28.25",
    },
  },
  { order: { ...order, items: [{ ...line, notes: "Different note" }] } },
  {
    order: {
      ...order,
      items: [{ ...line, variants: [{ ...line.variants[0], id: "other" }] }],
    },
  },
  { order: { ...order, items: [{ ...line, addOns: [] }] } },
  { order: { ...order, items: [{ ...line, basePrice: "0.01" }] } },
])(
  "rejects an incomplete, mismatched or arithmetically inconsistent confirmation: %j",
  (value) => {
    expect(isCreatedOrderResponse(value, request, "cafe")).toBe(false);
  },
);
it("checks the shop and code for dine-in confirmations", () => {
  const dineIn = {
    ...request,
    mode: "DINE_IN" as const,
    tableCode: "T12",
    tableToken: "signed",
  };
  const response = {
    order: {
      ...order,
      mode: "DINE_IN",
      table: { shopSlug: "cafe", code: "T12", number: "12" },
    },
  };
  expect(isCreatedOrderResponse(response, dineIn, "cafe")).toBe(true);
  expect(isCreatedOrderResponse(response, dineIn, "other")).toBe(false);
  expect(
    isCreatedOrderResponse(response, { ...dineIn, tableCode: "T13" }, "cafe"),
  ).toBe(false);
});
