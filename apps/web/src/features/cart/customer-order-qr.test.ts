import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";
import type { CustomerOrderResponse } from "@paserve/contracts";
import {
  captureCustomerOrderQr,
  clearCustomerOrderQrs,
  createCustomerQrImage,
  readCustomerOrderQr,
} from "./customer-order-qr";
import { saveOrderReceipt, orderReceipts } from "./order-receipt";
import { parseOrderQr } from "../orders/order-qr-reference";

const orderId = "e47f6994-a303-4a7b-87b0-2386d5198828";
const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
const expiry = Date.parse("2030-01-01T00:00:00Z");
const token = (changes = {}) =>
  `${Buffer.from(JSON.stringify({ v: 1, purpose: "order-receipt", shopId, orderId, nonce: "75992537-5d60-4d22-8e1e-60a114644681", exp: expiry, ...changes })).toString("base64url")}.${"a".repeat(43)}`;
const order: CustomerOrderResponse["order"] = {
  id: orderId,
  orderNumber: "ORD-000042",
  mode: "TAKEOUT",
  table: null,
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  currency: "PHP",
  totalPrice: "10.00",
  createdAt: "2026-10-13T00:00:00Z",
  updatedAt: "2026-10-13T00:00:00Z",
  items: [],
  qrToken: token(),
  qrTokenExpiresAt: new Date(expiry).toISOString(),
};
afterEach(() => {
  clearCustomerOrderQrs();
  orderReceipts.clearMemory();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("renders a real QR that decodes to exactly the supplied token and routes to the same order", async () => {
  const image = await createCustomerQrImage(order.qrToken!);
  const svg = decodeURIComponent(image.split(",").slice(1).join(","));
  expect(svg).not.toContain(order.qrToken);
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(640, 640)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const decoded = jsQR(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
  )?.data;
  expect(decoded).toBe(order.qrToken);
  expect(parseOrderQr(decoded!)).toMatchObject({ shopId, orderId });
});
it("restores the QR after memory loss while keeping the display receipt separate", () => {
  saveOrderReceipt("cafe", "Cafe", order);
  expect(readCustomerOrderQr("cafe", orderId)).toEqual({
    qrToken: order.qrToken,
    orderNumber: order.orderNumber,
    expiresAt: expiry,
  });
  const stored = sessionStorage.getItem(
    `paserve-order-receipt:v1:cafe:${orderId}`,
  )!;
  expect(stored).not.toContain(order.qrToken);
  expect(stored).not.toContain("qrToken");
  clearCustomerOrderQrs();
  expect(readCustomerOrderQr("cafe", orderId)?.qrToken).toBe(order.qrToken);
  expect(stored).toContain(order.orderNumber);
});
it("does not recover credentials from tampered storage or expose them under another route", () => {
  captureCustomerOrderQr("cafe", order);
  expect(readCustomerOrderQr("other", orderId)).toBeNull();
  expect(readCustomerOrderQr("cafe", shopId)).toBeNull();
  clearCustomerOrderQrs();
  sessionStorage.removeItem(`paserve-customer-qr:v1:cafe:${orderId}`);
  sessionStorage.setItem(
    `paserve-order-receipt:v1:cafe:${orderId}`,
    JSON.stringify(order),
  );
  expect(readCustomerOrderQr("cafe", orderId)).toBeNull();
});
it.each([
  { version: 2 },
  { shopSlug: "other" },
  { orderId: shopId },
  { qrToken: "ORD-000042" },
  { expiresAt: expiry + 1 },
  { qrToken: token({ orderId: shopId }) },
])("rejects corrupt or mismatched saved QR metadata %j", (changes) => {
  captureCustomerOrderQr("cafe", order);
  const storedKey = `paserve-customer-qr:v1:cafe:${orderId}`;
  const saved = JSON.parse(sessionStorage.getItem(storedKey)!);
  clearCustomerOrderQrs();
  sessionStorage.setItem(storedKey, JSON.stringify({ ...saved, ...changes }));
  expect(readCustomerOrderQr("cafe", orderId)).toBeNull();
  expect(sessionStorage.getItem(storedKey)).toBeNull();
});
it("retains the QR in memory if session storage is blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  captureCustomerOrderQr("cafe", order);
  expect(readCustomerOrderQr("cafe", orderId)?.qrToken).toBe(order.qrToken);
});
it.each([
  { qrToken: undefined },
  { qrToken: "ORD-000042" },
  { qrToken: token({ orderId: shopId }) },
  { qrToken: token({ purpose: "table-checkout" }) },
  { qrTokenExpiresAt: "invalid" },
  { qrTokenExpiresAt: new Date(expiry + 1).toISOString() },
  { orderNumber: undefined },
])("does not capture malformed or mismatched QR metadata %j", (changes) => {
  captureCustomerOrderQr("cafe", { ...order, ...changes });
  expect(readCustomerOrderQr("cafe", orderId)).toBeNull();
});
it("drops expired credentials at the exact boundary without extending their lifetime", () => {
  vi.useFakeTimers();
  vi.setSystemTime(expiry - 1);
  captureCustomerOrderQr("cafe", order);
  expect(readCustomerOrderQr("cafe", orderId)).not.toBeNull();
  vi.setSystemTime(expiry);
  expect(readCustomerOrderQr("cafe", orderId)).toBeNull();
  captureCustomerOrderQr("cafe", order);
  expect(readCustomerOrderQr("cafe", orderId)).toBeNull();
});
it("never treats an order number as QR content", async () => {
  await expect(createCustomerQrImage("ORD-000042")).rejects.toThrow(
    "unavailable",
  );
});
