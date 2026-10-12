import { expect, it } from "vitest";
import type { CreateCustomerOrderRequest } from "@paserve/contracts";
import { orderSubmissionRequest } from "./order-submission";

const line = {
  productId: "coffee",
  variantIds: ["large"],
  addOnIds: ["milk"],
  quantity: 2,
  notes: "Less ice",
  unitPrice: "0.01",
  totalPrice: "0.02",
  productName: "Forged name",
  variants: [{ id: "large", priceAdjustment: "0.00" }],
  addOns: [{ id: "milk", priceAdjustment: "0.00" }],
};
it("projects only identifiers, quantities and notes for pickup, including restored requests", () => {
  const request = {
    requestId: "request-a",
    mode: "TAKEOUT",
    totalPrice: "0.02",
    currency: "USD",
    tableId: "foreign",
    items: [line],
  } as unknown as CreateCustomerOrderRequest;
  expect(orderSubmissionRequest(request)).toEqual({
    requestId: "request-a",
    mode: "TAKEOUT",
    items: [
      {
        productId: "coffee",
        variantIds: ["large"],
        addOnIds: ["milk"],
        quantity: 2,
        notes: "Less ice",
      },
    ],
  });
});
it("retains signed dine-in context and omits blank optional input when absent", () => {
  const request = {
    requestId: "request-a",
    tableCode: "T12",
    tableToken: "signed",
    tableNumber: "Forged",
    items: [
      {
        productId: "coffee",
        variantIds: [],
        addOnIds: [],
        quantity: 1,
        basePrice: "0.01",
      },
    ],
  };
  expect(orderSubmissionRequest(request)).toEqual({
    requestId: "request-a",
    mode: "DINE_IN",
    tableCode: "T12",
    tableToken: "signed",
    items: [{ productId: "coffee", variantIds: [], addOnIds: [], quantity: 1 }],
  });
});
it("copies option ID arrays so later snapshot mutation cannot alter the outgoing payload", () => {
  const source = {
    requestId: "request-a",
    mode: "TAKEOUT" as const,
    items: [line],
  };
  const payload = orderSubmissionRequest(source);
  source.items[0].variantIds.push("other");
  expect(payload.items[0].variantIds).toEqual(["large"]);
  source.items[0].variantIds.pop();
});
