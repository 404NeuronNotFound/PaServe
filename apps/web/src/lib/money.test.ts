import { expect, it } from "vitest";
import {
  calculateAverageOrderValue,
  formatCartPrice,
  formatProductPrice,
} from "./money";

it.each([
  ["0", "₱0.00"],
  ["0.01", "₱0.01"],
  ["0.1", "₱0.10"],
  ["12.50", "₱12.50"],
  ["1234.56", "₱1,234.56"],
  ["99999999.99", "₱99,999,999.99"],
])("formats %s as exact pesos", (value, expected) => {
  expect(formatProductPrice(value)).toBe(expected);
});
it.each(["-1", "NaN", "Infinity", "1e2", "1.001", "100000000", "", "01"])(
  "does not display invalid money %s",
  (value) => {
    expect(formatProductPrice(value)).toBe("—");
  },
);
it("formats combined totals above the per-product storage limit exactly", () => {
  expect(formatCartPrice("9899999999.01")).toBe("₱9,899,999,999.01");
  expect(formatProductPrice("9899999999.01")).toBe("—");
  expect(formatCartPrice("1e9")).toBe("—");
});

it.each([
  ["0.00", 0, "0.00"],
  ["0.00", 5, "0.00"],
  ["123.45", 1, "123.45"],
  ["0.30", 2, "0.15"],
  ["10.00", 3, "3.33"],
  ["10.01", 3, "3.34"],
  ["0.01", 2, "0.01"],
  ["0.01", 3, "0.00"],
  ["1.99", 2, "1.00"],
  ["10000000060.32", 37, "270270271.90"],
  ["9007199254740993.01", 2, "4503599627370496.51"],
])("averages %s across %i eligible orders as %s", (sales, orders, expected) => {
  expect(calculateAverageOrderValue(sales, orders)).toBe(expected);
});
it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid AOV counts %s",
  (count) => {
    expect(() => calculateAverageOrderValue("10.00", count)).toThrow();
  },
);
