import { expect, it } from "vitest";
import { formatCartPrice, formatProductPrice } from "./money";

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
