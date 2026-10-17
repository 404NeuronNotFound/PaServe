import {
  SALES_PAYMENT_METHODS,
  type PaymentBreakdownEntry,
} from "@paserve/contracts";
export type PaymentMixBasis = "SALES" | "ORDERS";
const money = (value: string) =>
  /^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(value);
const validCount = (value: number) => Number.isSafeInteger(value) && value >= 0;
/** Largest-remainder allocation in basis points; fixed method order resolves ties. */
function shares(values: bigint[]): number[] {
  const total = values.reduce((n, value) => n + value, 0n);
  if (total === 0n) return values.map(() => 0);
  const allocated = values.map((value) => Number((value * 10000n) / total));
  const remainders = values
    .map((value, index) => ({ index, remainder: (value * 10000n) % total }))
    .sort((a, b) =>
      a.remainder > b.remainder
        ? -1
        : a.remainder < b.remainder
          ? 1
          : a.index - b.index,
    );
  const missing = 10000 - allocated.reduce((n, value) => n + value, 0);
  for (const entry of remainders.slice(0, missing)) allocated[entry.index]++;
  return allocated;
}
const percentage = (basisPoints: number) =>
  `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}%`;
export function calculatePaymentMix(
  entries: PaymentBreakdownEntry[],
  totalSales: string,
  completedOrders: number,
) {
  const invalid = () => {
    throw new Error("Payment mix does not match the selected sales report.");
  };
  if (
    typeof totalSales !== "string" ||
    !money(totalSales) ||
    !validCount(completedOrders) ||
    !Array.isArray(entries) ||
    entries.length !== SALES_PAYMENT_METHODS.length
  )
    return invalid();
  for (const [index, entry] of entries.entries()) {
    if (
      !entry ||
      entry.paymentMethod !== SALES_PAYMENT_METHODS[index] ||
      !validCount(entry.orders) ||
      typeof entry.totalSales !== "string" ||
      !money(entry.totalSales) ||
      (entry.orders === 0 && entry.totalSales !== "0.00")
    )
      return invalid();
  }
  const sales = entries.map((entry) =>
    BigInt(entry.totalSales.replace(".", "")),
  );
  const orders = entries.map((entry) => BigInt(entry.orders));
  if (
    sales.reduce((n, value) => n + value, 0n) !==
      BigInt(totalSales.replace(".", "")) ||
    orders.reduce((n, value) => n + value, 0n) !== BigInt(completedOrders)
  )
    return invalid();
  const salesShares = shares(sales),
    orderShares = shares(orders);
  return entries.map((entry, index) => ({
    ...entry,
    salesBasisPoints: salesShares[index],
    orderBasisPoints: orderShares[index],
    salesShare: percentage(salesShares[index]),
    orderShare: percentage(orderShares[index]),
  }));
}
