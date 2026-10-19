import { parseCartLine } from "./cart-storage";
import { describe, expect, it } from "vitest";
import {
  isValidCatalogName,
  normalizeCatalogName,
  isValidOrderQuantity,
  isValidCustomerNote,
  PRODUCT_PRICE_PATTERN,
  CATEGORY_LIMITS,
} from "@paserve/contracts";

describe("shared frontend validation", () => {
  it("restores a valid Unicode note without losing a cart line", () => {
    const line = {
      lineId: "line",
      productId: "coffee",
      productName: "Coffee",
      currency: "PHP",
      basePrice: "1.00",
      unitPrice: "1.00",
      totalPrice: "1.00",
      quantity: 1,
      variants: [],
      addOns: [],
      notes: "\u{1f600}".repeat(300),
    };
    expect(parseCartLine(line)?.notes).toBe(line.notes);
    expect(parseCartLine({ ...line, notes: line.notes + "a" })).toBeNull();
  });
  it("matches API Unicode limits and preserves invalid names for field errors", () => {
    expect(
      isValidCatalogName("\u{1f600}".repeat(80), CATEGORY_LIMITS.nameMax),
    ).toBe(true);
    expect(
      isValidCatalogName("\u{1f600}".repeat(81), CATEGORY_LIMITS.nameMax),
    ).toBe(false);
    for (const value of ["Coffee\n", "\tCoffee", "Coffee\ud800"]) {
      expect(normalizeCatalogName(value, true)).toBe(value);
      expect(isValidCatalogName(value, CATEGORY_LIMITS.nameMax)).toBe(false);
    }
    expect(normalizeCatalogName("  Cold   brew  ", true)).toBe("Cold brew");
  });
  it("requires integer quantities and exact catalog prices", () => {
    for (const value of [0, 100, 1.1, "2", NaN])
      expect(isValidOrderQuantity(value)).toBe(false);
    expect(isValidOrderQuantity(99)).toBe(true);
    for (const value of ["1.00\n", "1e2", "1.001"])
      expect(PRODUCT_PRICE_PATTERN.test(value)).toBe(false);
  });
  it("allows plain Unicode preparation notes with line breaks and rejects unsafe controls", () => {
    expect(isValidCustomerNote("\u{1f600}".repeat(300))).toBe(true);
    expect(isValidCustomerNote("\u{1f600}".repeat(301))).toBe(false);
    expect(isValidCustomerNote("Less ice\nNo sugar")).toBe(true);
    expect(isValidCustomerNote("\u0000")).toBe(false);
    expect(isValidCustomerNote("\u202e")).toBe(false);
  });
});
