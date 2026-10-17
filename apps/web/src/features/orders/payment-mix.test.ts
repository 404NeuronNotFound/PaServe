import { expect, it } from "vitest";
import { SALES_PAYMENT_METHODS } from "@paserve/contracts";
import { calculatePaymentMix } from "./payment-mix";
const entries = (orders: number[], totals: string[]) =>
  SALES_PAYMENT_METHODS.map((paymentMethod, index) => ({
    paymentMethod,
    orders: orders[index],
    totalSales: totals[index],
  }));
it("calculates sales and order shares independently, with exact 100% reconciliation", () => {
  const mix = calculatePaymentMix(
    entries([2, 1, 3, 1], ["30.00", "60.00", "10.00", "0.00"]),
    "100.00",
    7,
  );
  expect(mix.map((entry) => entry.salesShare)).toEqual([
    "30.00%",
    "60.00%",
    "10.00%",
    "0.00%",
  ]);
  expect(mix.map((entry) => entry.orderShare)).toEqual([
    "28.57%",
    "14.29%",
    "42.86%",
    "14.28%",
  ]);
  expect(mix.reduce((n, entry) => n + entry.salesBasisPoints, 0)).toBe(10000);
  expect(mix.reduce((n, entry) => n + entry.orderBasisPoints, 0)).toBe(10000);
});
it("resolves rounding ties reproducibly without awarding shares to unused methods", () => {
  const groups = entries([1, 1, 1, 0], ["1.00", "1.00", "1.00", "0.00"]);
  const first = calculatePaymentMix(groups, "3.00", 3);
  expect(first.map((entry) => entry.salesShare)).toEqual([
    "33.34%",
    "33.33%",
    "33.33%",
    "0.00%",
  ]);
  expect(calculatePaymentMix(groups, "3.00", 3)).toEqual(first);
});
it("uses exact cents beyond the safe floating point range", () => {
  const mix = calculatePaymentMix(
    entries(
      [1, 1, 0, 0],
      ["90071992547409.91", "90071992547409.92", "0.00", "0.00"],
    ),
    "180143985094819.83",
    2,
  );
  expect(mix.map((entry) => entry.salesShare)).toEqual([
    "50.00%",
    "50.00%",
    "0.00%",
    "0.00%",
  ]);
});
it("keeps a meaningful order mix when all paid orders have zero sales", () => {
  const mix = calculatePaymentMix(
    entries([0, 2, 0, 0], ["0.00", "0.00", "0.00", "0.00"]),
    "0.00",
    2,
  );
  expect(mix.map((entry) => entry.salesShare)).toEqual([
    "0.00%",
    "0.00%",
    "0.00%",
    "0.00%",
  ]);
  expect(mix[1].orderShare).toBe("100.00%");
});
it("returns zero shares for empty periods", () => {
  const mix = calculatePaymentMix(
    entries([0, 0, 0, 0], ["0.00", "0.00", "0.00", "0.00"]),
    "0.00",
    0,
  );
  expect(
    mix.every(
      (entry) => entry.salesShare === "0.00%" && entry.orderShare === "0.00%",
    ),
  ).toBe(true);
});
it.each([
  "missing",
  "methods",
  "orders",
  "sales",
  "negative",
  "unpaidValue",
  "malformed",
])("rejects unreconciled %s inputs", (kind) => {
  const groups = entries([1, 0, 0, 0], ["1.00", "0.00", "0.00", "0.00"]);
  if (kind === "missing") groups.pop();
  if (kind === "methods") groups.reverse();
  if (kind === "orders") groups[0].orders = 2;
  if (kind === "sales") groups[0].totalSales = "1.01";
  if (kind === "negative") groups[0].orders = -1;
  if (kind === "unpaidValue") groups[1].totalSales = "1.00";
  if (kind === "malformed") groups[0].totalSales = "1.00\n";
  expect(() => calculatePaymentMix(groups, "1.00", 1)).toThrow(
    "does not match",
  );
});
