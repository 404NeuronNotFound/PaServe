import { afterEach, expect, it } from "vitest";
import { readOrderReceipt, recoverOrderReceipt, orderReceipts } from "./order-receipt";
import { cashierLine } from "../../test/cashier-fixtures";

const receipt = {
  shopSlug: "cafe", shopName: "Current name", id: "order-a", orderNumber: "ORD-000001",
  mode: "TAKEOUT", table: null, status: "PENDING_CONFIRMATION", currency: "PHP", totalPrice: "12.00",
};
const details = { name: "Original Cafe", address: "12 Old Street", phone: "09171234567", contactEmail: null, website: null };
it("recovers recorded method and safe reference without internal payment fields", () => {
  recoverOrderReceipt("cafe", "order-a", { ...receipt, payment: {
    method: "CARD_MANUAL", reference: "00001234", description: null,
    paidBy: "private-cashier", requestId: "private-request",
  } });
  orderReceipts.clearMemory();
  const saved = readOrderReceipt("cafe", "order-a");
  expect(saved?.payment).toEqual({ method: "CARD_MANUAL", reference: "00001234", description: null });
  expect(JSON.stringify(saved)).not.toContain("private");
});
afterEach(() => { sessionStorage.clear(); orderReceipts.clearMemory(); });
it("restores historical shop details and allowlists display fields", () => {
  recoverOrderReceipt("cafe", "order-a", { ...receipt, shopDetails: { ...details, secret: "private" } });
  orderReceipts.clearMemory();
  const restored = readOrderReceipt("cafe", "order-a");
  expect(restored?.shopDetails).toEqual(details);
  expect(restored?.shopName).toBe("Original Cafe");
  expect(JSON.stringify(restored)).not.toContain("private");
});
it("keeps legacy receipts usable without shop contact details", () => {
  expect(readOrderReceipt("cafe", "order-a", receipt)?.shopDetails).toBeUndefined();
});
it("rejects malformed shop details", () => {
  expect(readOrderReceipt("cafe", "order-a", { ...receipt, shopDetails: { ...details, phone: {} } })).toBeNull();
});

it("recovers separate saved item snapshots after storage/memory loss without extra fields", () => {
  const source = { ...receipt, totalPrice: "271.00", items: [cashierLine, { ...cashierLine, secret: "private" }] };
  recoverOrderReceipt("cafe", "order-a", source);
  source.items[0] = { ...cashierLine, productName: "Changed menu name" };
  orderReceipts.clearMemory();
  const saved = readOrderReceipt("cafe", "order-a");
  expect(saved?.items).toEqual([cashierLine, cashierLine]);
  expect(JSON.stringify(saved)).not.toContain("private");
});
it.each([{ items: [] }, { items: [{ ...cashierLine, quantity: 3 }] }, { items: [{ ...cashierLine, totalPrice: "0.00" }] }])(
  "rejects incomplete or inconsistent saved lines: %j", ({ items }) => {
    expect(readOrderReceipt("cafe", "order-a", { ...receipt, totalPrice: "135.50", items })).toBeNull();
  },
);
