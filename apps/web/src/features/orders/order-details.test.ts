import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api/client";
import {
  getOrderDetails,
  orderDetailsKey,
  parseOrderDetails,
} from "./order-details";
import { orderDetailsFixture } from "./__fixtures__/order-details";

afterEach(() => vi.restoreAllMocks());
it("loads an explicit shop/resource with cancellation and isolates cache entries by actor/shop/order", async () => {
  const data = orderDetailsFixture();
  const get = vi.spyOn(api, "get").mockResolvedValue({ data });
  const signal = new AbortController().signal;
  expect(await getOrderDetails("shop-a", "order-a", signal)).toEqual(data);
  expect(get).toHaveBeenCalledWith(
    "/shops/shop-a/orders/order-a/details",
    expect.objectContaining({ signal, timeout: expect.any(Number) }),
  );
  for (const args of [
    ["other", "shop-a", "order-a"],
    ["owner", "other", "order-a"],
    ["owner", "shop-a", "other"],
  ])
    expect(orderDetailsKey(...(args as [string, string, string]))).not.toEqual(
      orderDetailsKey("owner", "shop-a", "order-a"),
    );
});
it.each([
  { status: "PENDING_CONFIRMATION" },
  { status: "REJECTED" },
  { paymentStatus: "UNPAID" },
  { preparationStatus: "READY" },
  { completedAt: null },
  { updatedAt: "2026-10-15T00:00:00.000Z" },
  { history: [] },
  {
    history: [
      { status: "PLACED", at: "2026-10-16T00:00:00.000Z", actorId: null },
    ],
  },
  {
    payment: {
      method: "CASH",
      amountReceived: "50.00",
      changeDue: "13.00",
      reference: null,
      description: null,
    },
  },
  {
    payment: {
      method: "CASH",
      amountReceived: "50.00",
      reference: null,
      description: null,
    },
  },
  { id: "other" },
  { shopId: "foreign" },
  { status: "UNKNOWN" },
  { paymentStatus: "REFUNDED" },
  { preparationStatus: "UNKNOWN" },
  { totalPrice: "-1.00" },
  { currency: "USD" },
  { createdAt: "2026-02-30T00:00:00Z" },
  { mode: "TAKEOUT", tableNumber: "Patio 2" },
  { items: [] },
  { items: null, snapshotIssue: null },
  { permittedActions: ["COMPLETE"] },
  { permittedActions: ["RECEIPT", "RECEIPT"] },
  {
    history: [
      { status: "INVENTED", at: "2026-10-16T00:00:00Z", actorId: null },
    ],
  },
])("rejects foreign, corrupt and unsafe action projections: %j", (patch) => {
  const data = orderDetailsFixture();
  Object.assign(data.order, patch);
  expect(() => parseOrderDetails(data, "shop-a", "order-a")).toThrow(
    /could not be verified/,
  );
});
it("allows metadata-only review for unavailable snapshots and redacts unsafe receipt references", () => {
  const data = orderDetailsFixture();
  data.order.items = null;
  data.order.snapshotIssue = "Saved items unavailable";
  data.order.permittedActions = [];
  data.order.payment = {
    method: "CARD_MANUAL",
    reference: "4111 1111 1111 1111",
    description: null,
  };
  expect(
    parseOrderDetails(data, "shop-a", "order-a").order.payment?.reference,
  ).toBeNull();
});
it("checks saved line arithmetic without loading current menu products", () => {
  const data = orderDetailsFixture();
  data.order.items![0].unitPrice = "19.00";
  expect(() => parseOrderDetails(data, "shop-a", "order-a")).toThrow();
});
it("keeps supported legacy missing metadata readable without inventing milestones", () => {
  const data = orderDetailsFixture();
  Object.assign(data.order, {
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    preparationStatus: null,
    paidAt: null,
    completedAt: null,
    payment: null,
    history: [data.order.history[0]],
    permittedActions: ["CASHIER"],
  });
  expect(
    parseOrderDetails(data, "shop-a", "order-a").order.permittedActions,
  ).toEqual(["CASHIER"]);
});
it("rejects plausible-looking milestones that contradict saved payment and completion timestamps", () => {
  const data = orderDetailsFixture();
  data.order.history[1].at = "2026-10-16T00:02:00.000Z";
  expect(() => parseOrderDetails(data, "shop-a", "order-a")).toThrow();
  data.order.history[1].at = data.order.paidAt!;
  data.order.history[2].at = "2026-10-16T00:04:00.000Z";
  expect(() => parseOrderDetails(data, "shop-a", "order-a")).toThrow();
});
