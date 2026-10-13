import { afterEach, expect, it, vi } from "vitest";
import type { VerifyOrderQrResponse } from "@paserve/contracts";
import { decideOrder } from "./order-decision";
import { api } from "../../lib/api/client";
import { cashierLine } from "../../test/cashier-fixtures";

const order: VerifyOrderQrResponse["order"] = {
  id: "order-a",
  shopId: "shop-a",
  orderNumber: "ORD-000042",
  mode: "TAKEOUT",
  tableNumber: null,
  currency: "PHP",
  totalPrice: "135.50",
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  items: [cashierLine],
  reviewVersion: "a".repeat(64),
};
const result = {
  id: order.id,
  shopId: order.shopId,
  orderNumber: order.orderNumber,
  status: "CONFIRMED",
  paymentStatus: "UNPAID",
  decidedBy: "cashier-a",
  decidedAt: "2026-10-13T00:00:00.000Z",
  rejectionReason: null,
};
afterEach(() => vi.restoreAllMocks());
it("sends only token and reviewed version to the fixed shop/order confirmation endpoint", async () => {
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ data: { order: result } });
  const signal = new AbortController().signal;
  expect(
    await decideOrder(order, "credential", "confirm", "ignore me", signal),
  ).toEqual(result);
  expect(post).toHaveBeenCalledWith(
    "/shops/shop-a/orders/order-a/confirm",
    { qrToken: "credential", reviewVersion: order.reviewVersion },
    { signal, timeout: 15000 },
  );
});
it("sends a trimmed rejection reason without order details or payment fields", async () => {
  const saved = {
    ...result,
    status: "REJECTED",
    rejectionReason: "Wrong order",
  };
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ data: { order: saved } });
  const signal = new AbortController().signal;
  expect(
    await decideOrder(order, "credential", "reject", "  Wrong order  ", signal),
  ).toEqual(saved);
  expect(post).toHaveBeenCalledWith(
    "/shops/shop-a/orders/order-a/reject",
    {
      qrToken: "credential",
      reviewVersion: order.reviewVersion,
      rejectionReason: "Wrong order",
    },
    { signal, timeout: 15000 },
  );
});
it.each([
  undefined,
  { ...result, id: "another-order" },
  { ...result, shopId: "another-shop" },
  { ...result, status: "REJECTED" },
  { ...result, paymentStatus: "PAID" },
  { ...result, decidedAt: "invalid" },
  { ...result, decidedBy: null },
])("fails closed for an unverified decision response %j", async (saved) => {
  vi.spyOn(api, "post").mockResolvedValue({ data: { order: saved } });
  await expect(
    decideOrder(
      order,
      "credential",
      "confirm",
      "",
      new AbortController().signal,
    ),
  ).rejects.toThrow("could not be verified");
});
