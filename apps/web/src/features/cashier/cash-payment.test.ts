import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api/client";
import {
  normalizeCashAmount,
  cashChange,
  reviewCashPayment,
  collectCashPayment,
  lookupCashPayment,
  recordManualGcashPayment,
  recordManualCardPayment,
  recordOtherPayment,
} from "./cash-payment";
import { cashierLine } from "../../test/cashier-fixtures";
vi.mock("../../lib/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  AUTH_REQUEST_TIMEOUT_MS: 15000,
}));
vi.mock("../auth/api/session", () => ({}));
const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e",
  orderId = "e47f6994-a303-4a7b-87b0-2386d5198828",
  requestId = "58bb31e6-9c13-4c07-9e04-fbb29b0584ab";
const order = {
  id: orderId,
  shopId,
  orderNumber: "ORD-000042",
  mode: "TAKEOUT" as const,
  tableNumber: null,
  currency: "PHP",
  totalPrice: "135.50",
  status: "CONFIRMED",
  paymentStatus: "UNPAID",
  items: [cashierLine],
  reviewVersion: "a".repeat(64),
};
const payment = {
  method: "CASH",
  requestId,
  amountReceived: "200.00",
  changeDue: "64.50",
  paidAt: "2026-10-13T00:00:00.000Z",
  paidBy: "cashier",
};
beforeEach(() => {
  vi.resetAllMocks();
});
it("records OTHER description and verifies the saved metadata", async () => {
  const receipt = {
    ...payment,
    method: "OTHER",
    amountReceived: "135.50",
    changeDue: "0.00",
    reference: "00001234 receipt",
    description: "Bank transfer",
  };
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...order, paymentStatus: "PAID" }, payment: receipt },
  });
  const dto = {
    requestId,
    reviewVersion: order.reviewVersion,
    receivedConfirmed: true as const,
    reference: receipt.reference,
    description: receipt.description,
  };
  const signal = new AbortController().signal;
  expect(
    (await recordOtherPayment(shopId, orderId, dto, signal)).payment
      ?.description,
  ).toBe("Bank transfer");
  expect(api.post).toHaveBeenCalledWith(
    `/shops/${shopId}/orders/${orderId}/other-payment`,
    dto,
    { signal, timeout: 15000 },
  );
  for (const description of [null, "", "Shop voucher", "CVV: 123"]) {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        order: { ...order, paymentStatus: "PAID" },
        payment: { ...receipt, description },
      },
    });
    await expect(
      recordOtherPayment(shopId, orderId, dto, signal),
    ).rejects.toThrow();
  }
});
it("records external card completion and retains its reference without accepting another method", async () => {
  const receipt = {
    ...payment,
    method: "CARD_MANUAL",
    amountReceived: "135.50",
    changeDue: "0.00",
    reference: "00001234 terminal receipt",
  };
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...order, paymentStatus: "PAID" }, payment: receipt },
  });
  const dto = {
    requestId,
    reviewVersion: order.reviewVersion,
    receivedConfirmed: true as const,
    reference: receipt.reference,
  };
  const signal = new AbortController().signal;
  expect(
    (await recordManualCardPayment(shopId, orderId, dto, signal)).payment
      ?.method,
  ).toBe("CARD_MANUAL");
  expect(api.post).toHaveBeenCalledWith(
    `/shops/${shopId}/orders/${orderId}/card-manual-payment`,
    dto,
    { signal, timeout: 15000 },
  );
  vi.mocked(api.post).mockResolvedValue({
    data: {
      order: { ...order, paymentStatus: "PAID" },
      payment: { ...receipt, method: "GCASH_MANUAL" },
    },
  });
  await expect(
    recordManualCardPayment(shopId, orderId, dto, signal),
  ).rejects.toThrow();
});
it.each([
  ["200", "200.00"],
  [" 135.5 ", "135.50"],
  ["0", "0.00"],
  ["0.1", "0.10"],
  ["0.30", "0.30"],
  ["9999999999.99", "9999999999.99"],
])("normalizes entered cash %s", (raw, expected) => {
  expect(normalizeCashAmount(raw)).toBe(expected);
});
it.each([
  "-1",
  "1e3",
  "1,000",
  "200.001",
  "10000000000",
  "01",
  ".5",
  "NaN",
  "Infinity",
  "+200",
  "200abc",
  "1_000",
  "",
])("rejects malformed cash %s", (raw) => {
  expect(normalizeCashAmount(raw)).toBeNull();
});
it("calculates change exactly without floating point rounding", () => {
  expect(cashChange("200.00", "135.50")).toBe("64.50");
  expect(cashChange("0.30", "0.10")).toBe("0.20");
  expect(cashChange("135.50", "135.50")).toBe("0.00");
  expect(cashChange("135.49", "135.50")).toBeNull();
});
it("loads the authoritative confirmed order with fixed shop route", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { order, payment: null } });
  const signal = new AbortController().signal;
  expect((await reviewCashPayment(shopId, orderId, signal)).order).toEqual(
    order,
  );
  expect(api.get).toHaveBeenCalledWith(
    `/shops/${shopId}/orders/${orderId}/cash-payment`,
    { signal, timeout: 15000 },
  );
});
it("sends only cash amount, request ID and reviewed version and checks the receipt", async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...order, paymentStatus: "PAID" }, payment },
  });
  const dto = {
    requestId,
    amountReceived: "200.00",
    reviewVersion: order.reviewVersion,
  };
  const saved = await collectCashPayment(
    shopId,
    orderId,
    dto,
    new AbortController().signal,
  );
  expect(saved.payment?.changeDue).toBe("64.50");
  expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(dto);
});
it.each([
  { changeDue: "99.00" },
  { amountReceived: "100.00" },
  { method: "CARD" },
  { paidBy: "" },
  { paidAt: "bad" },
  { requestId: "bad" },
])("rejects inconsistent paid receipt %j", async (fields) => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      order: { ...order, paymentStatus: "PAID" },
      payment: { ...payment, ...fields },
    },
  });
  await expect(
    reviewCashPayment(shopId, orderId, new AbortController().signal),
  ).rejects.toThrow();
});
it("rejects pending, cross-shop and mixed payment state", async () => {
  for (const data of [
    { order: { ...order, status: "PENDING_CONFIRMATION" }, payment: null },
    { order: { ...order, shopId: "other" }, payment: null },
    { order, payment },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ data });
    await expect(
      reviewCashPayment(shopId, orderId, new AbortController().signal),
    ).rejects.toThrow();
  }
});
it("looks up a confirmed order by normalized number", async () => {
  vi.mocked(api.post).mockResolvedValue({ data: { order, payment: null } });
  await lookupCashPayment(shopId, " ord-000042 ", new AbortController().signal);
  expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({
    orderNumber: "ORD-000042",
  });
});
it("rejects mismatched response number", async () => {
  vi.mocked(api.post).mockResolvedValue({ data: { order, payment: null } });
  await expect(
    lookupCashPayment(shopId, "ORD-000043", new AbortController().signal),
  ).rejects.toThrow();
});
it("records manual GCash attestation without trusting a client amount", async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: {
      order: { ...order, paymentStatus: "PAID" },
      payment: {
        ...payment,
        method: "GCASH_MANUAL",
        amountReceived: "135.50",
        changeDue: "0.00",
      },
    },
  });
  const dto = {
    requestId,
    reviewVersion: order.reviewVersion,
    receivedConfirmed: true as const,
  };
  const signal = new AbortController().signal;
  const saved = await recordManualGcashPayment(shopId, orderId, dto, signal);
  expect(saved.payment?.method).toBe("GCASH_MANUAL");
  expect(api.post).toHaveBeenCalledWith(
    `/shops/${shopId}/orders/${orderId}/gcash-manual-payment`,
    dto,
    { signal, timeout: 15000 },
  );
});
it("rejects manual GCash receipt with cash change or the wrong method", async () => {
  for (const receipt of [payment, { ...payment, method: "GCASH_MANUAL" }]) {
    vi.mocked(api.post).mockResolvedValue({
      data: { order: { ...order, paymentStatus: "PAID" }, payment: receipt },
    });
    await expect(
      recordManualGcashPayment(
        shopId,
        orderId,
        {
          requestId,
          reviewVersion: order.reviewVersion,
          receivedConfirmed: true,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  }
});
it("retains a saved GCash reference and checks it against the submitted note", async () => {
  const receipt = {
    ...payment,
    method: "GCASH_MANUAL",
    amountReceived: "135.50",
    changeDue: "0.00",
    reference: "001234567890 - checked",
  };
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...order, paymentStatus: "PAID" }, payment: receipt },
  });
  const dto = {
    requestId,
    reviewVersion: order.reviewVersion,
    receivedConfirmed: true as const,
    reference: receipt.reference,
  };
  expect(
    (
      await recordManualGcashPayment(
        shopId,
        orderId,
        dto,
        new AbortController().signal,
      )
    ).payment?.reference,
  ).toBe(receipt.reference);
  expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(dto);
  await expect(
    recordManualGcashPayment(
      shopId,
      orderId,
      { ...dto, reference: "other" },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});
