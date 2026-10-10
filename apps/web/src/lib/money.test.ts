import { expect, it } from "vitest";
import { formatProductPrice } from "./money";

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
