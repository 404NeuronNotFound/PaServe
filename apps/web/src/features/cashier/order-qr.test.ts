import { afterEach, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import sharp from "sharp";
import { parseOrderQr, verifyScannedOrder } from "./order-qr";
import { loadQrDecoder, readQrImage } from "./qr-decoder";
import { api } from "../../lib/api/client";
import { cashierLine } from "../../test/cashier-fixtures";

const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
const orderId = "e47f6994-a303-4a7b-87b0-2386d5198828";
const claims = {
  v: 1,
  purpose: "order-receipt",
  shopId,
  orderId,
  nonce: "75992537-5d60-4d22-8e1e-60a114644681",
  exp: 1792454400000,
};
const encode = (value: unknown) =>
  `${Buffer.from(JSON.stringify(value)).toString("base64url")}.${"a".repeat(43)}`;
const token = encode(claims);
const order = {
  id: orderId,
  shopId,
  orderNumber: "ORD-000001",
  mode: "TAKEOUT",
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  reviewVersion: "a".repeat(64),
  currency: "PHP",
  totalPrice: "135.50",
  tableNumber: null,
  items: [cashierLine],
};
afterEach(() => vi.restoreAllMocks());
it("extracts routing fields without treating an unsigned fixture as verified", () => {
  expect(parseOrderQr(` ${token}\n`)).toEqual({
    shopId,
    orderId,
    qrToken: token,
  });
});
it.each([
  "T12",
  "ORD-000001",
  orderId,
  "https://example.com/menu/cafe",
  "a".repeat(1025),
  encode({ ...claims, purpose: "table-checkout" }),
  encode({ ...claims, v: 2 }),
  encode({ ...claims, orderId: `${orderId}\n` }),
  encode({ ...claims, exp: "1792454400000" }),
  encode({ ...claims, nonce: "invalid" }),
])("rejects non-order or malformed QR payload %s", (raw) => {
  expect(parseOrderQr(raw)).toBeNull();
});
it("sends only the signed token to a shop-scoped authenticated verification read", async () => {
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ data: { verified: true, order } });
  const signal = new AbortController().signal;
  expect(await verifyScannedOrder(shopId, token, signal)).toEqual(order);
  expect(post).toHaveBeenCalledWith(
    `/shops/${shopId}/orders/scan-qr`,
    { qrToken: token },
    { signal, timeout: 15000 },
  );
});
it("never sends a foreign-shop scan to an API", async () => {
  const post = vi.spyOn(api, "post");
  await expect(
    verifyScannedOrder(
      "55b18d73-f2fb-4fe6-bb1c-30cf385c3b24",
      token,
      new AbortController().signal,
    ),
  ).rejects.toThrow("another shop");
  expect(post).not.toHaveBeenCalled();
});
it("sends the token to the fixed active-shop endpoint and ignores embedded order details and URLs", async () => {
  const raw = encode({
    ...claims,
    orderNumber: "ORD-999999",
    totalPrice: "0.01",
    paymentStatus: "PAID",
    status: "CONFIRMED",
    verificationUrl: "https://example.com/steal",
  });
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ data: { verified: true, order } });
  const signal = new AbortController().signal;
  const saved = await verifyScannedOrder(shopId, raw, signal);
  expect(post).toHaveBeenCalledWith(
    `/shops/${shopId}/orders/scan-qr`,
    { qrToken: raw },
    { signal, timeout: 15000 },
  );
  expect(saved).toEqual(order);
  expect(saved.totalPrice).toBe("135.50");
  expect(saved.paymentStatus).toBe("UNPAID");
});
it("rejects invalid scan contents before sending a request", async () => {
  const post = vi.spyOn(api, "post");
  await expect(
    verifyScannedOrder(shopId, "ORD-000001", new AbortController().signal),
  ).rejects.toThrow("not a PaServe order QR");
  expect(post).not.toHaveBeenCalled();
});
it.each([
  undefined,
  [],
  [{ ...cashierLine, quantity: 0 }],
  [{ ...cashierLine, totalPrice: "1.00" }],
  [{ ...cashierLine, unitPrice: "1.00" }],
  [{ ...cashierLine, notes: "a".repeat(301) }],
  [{ ...cashierLine, addOns: null }],
])(
  "fails closed for missing or inconsistent receipt lines %j",
  async (items) => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { verified: true, order: { ...order, items } },
    });
    await expect(
      verifyScannedOrder(shopId, token, new AbortController().signal),
    ).rejects.toThrow("saved items could not be loaded");
  },
);
it.each([
  { ...order, mode: "DINE_IN", tableNumber: null },
  { ...order, tableNumber: "A3" },
])("rejects inconsistent table/type context %j", async (saved) => {
  vi.spyOn(api, "post").mockResolvedValue({
    data: { verified: true, order: saved },
  });
  await expect(
    verifyScannedOrder(shopId, token, new AbortController().signal),
  ).rejects.toThrow("type and table");
});
it.each([
  { ...order, shopId: "other" },
  { ...order, id: "other" },
  { ...order, totalPrice: "NaN" },
  { ...order, totalPrice: "01.00" },
  { ...order, orderNumber: "ORD-000000" },
  { ...order, orderNumber: "ORD-000001\n" },
  { ...order, orderNumber: "ORD-9999999999999999999" },
  { ...order, currency: "USD" },
  { ...order, status: "CONFIRMED" },
  { ...order, status: "UNKNOWN" },
  { ...order, paymentStatus: "PAID" },
  { ...order, reviewVersion: `${"a".repeat(64)}\n` },
])(
  "does not display a mismatched or invalid verification response %j",
  async (invalid) => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { verified: true, order: invalid },
    });
    await expect(
      verifyScannedOrder(shopId, token, new AbortController().signal),
    ).rejects.toThrow("response could not be verified");
  },
);
it("projects only reviewed fields even if a response contains private metadata", async () => {
  vi.spyOn(api, "post").mockResolvedValue({
    data: {
      verified: true,
      order: {
        ...order,
        qrToken: "private",
        requestHash: "private",
        rawSnapshot: {},
      },
    },
  });
  const saved = await verifyScannedOrder(
    shopId,
    token,
    new AbortController().signal,
  );
  expect(saved).toEqual(order);
  expect(saved).not.toHaveProperty("qrToken");
  expect(saved).not.toHaveProperty("requestHash");
});
it("decodes a real generated PaServe token QR using the production decoder", async () => {
  const png = await QRCode.toBuffer(token, { width: 800, margin: 4 });
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = (await loadQrDecoder())(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
  );
  expect(result?.data).toBe(token);
  expect(parseOrderQr(result!.data)?.orderId).toBe(orderId);
});
it.each([
  new File(["data"], "qr.svg", { type: "image/svg+xml" }),
  new File([], "qr.png", { type: "image/png" }),
  new File([new Uint8Array(10 * 1024 * 1024 + 1)], "qr.png", {
    type: "image/png",
  }),
])(
  "rejects unsafe, empty or oversized image input before decoding",
  async (file) => {
    await expect(readQrImage(file)).rejects.toThrow("up to 10 MB");
  },
);
