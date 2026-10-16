import { afterEach, expect, it } from "vitest";
import { readOrderReceipt, recoverOrderReceipt, orderReceipts } from "./order-receipt";

const receipt = {
  shopSlug: "cafe", shopName: "Current name", id: "order-a", orderNumber: "ORD-000001",
  mode: "TAKEOUT", table: null, status: "PENDING_CONFIRMATION", currency: "PHP", totalPrice: "12.00",
};
const details = { name: "Original Cafe", address: "12 Old Street", phone: "09171234567", contactEmail: null, website: null };
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
