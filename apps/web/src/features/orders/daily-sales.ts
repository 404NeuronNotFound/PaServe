import {
  SALES_TIMEZONE,
  SALES_PAYMENT_METHODS,
  isReceiptTimestamp,
  salesBusinessDayBounds,
  type DailySalesResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import "../auth/api/session";
import { isOrderNumber, isOrderTotal } from "../cart/order-receipt-fields";

// Detail routes require UUIDs; safe legacy public receipt IDs are not enough.
const orderIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/i;

export async function getDailySales(
  shopId: string,
  date: string,
  signal: AbortSignal,
) {
  const bounds = salesBusinessDayBounds(date);
  if (!bounds) throw new Error("Choose a valid business date.");
  const { data } = await api.get<DailySalesResponse>(
    `/shops/${encodeURIComponent(shopId)}/reports/daily-sales`,
    { params: { date }, signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  if (
    !data ||
    data.shopId !== shopId ||
    data.businessDate !== date ||
    data.timezone !== SALES_TIMEZONE ||
    data.from !== bounds.from ||
    data.to !== bounds.to ||
    data.currency !== "PHP" ||
    typeof data.totalSales !== "string" ||
    !/^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(data.totalSales) ||
    !Number.isSafeInteger(data.completedOrders) ||
    data.completedOrders < 0 ||
    !Number.isSafeInteger(data.itemsSold) ||
    data.itemsSold < 0 ||
    (data.completedOrders === 0 && data.itemsSold !== 0) ||
    (data.completedOrders === 0 && data.totalSales !== "0.00")
  ) {
    throw new Error("Sales could not be verified. Please refresh.");
  }
  if (
    !Array.isArray(data.paymentBreakdown) ||
    data.paymentBreakdown.length !== SALES_PAYMENT_METHODS.length
  ) {
    throw new Error("Payment breakdown could not be verified. Please refresh.");
  }
  let orders = 0;
  let cents = 0n;
  for (const [index, entry] of data.paymentBreakdown.entries()) {
    if (
      !entry ||
      entry.paymentMethod !== SALES_PAYMENT_METHODS[index] ||
      !Number.isSafeInteger(entry.orders) ||
      entry.orders < 0 ||
      typeof entry.totalSales !== "string" ||
      !/^(?:0|[1-9]\d*)\.\d{2}$(?![\s\S])/.test(entry.totalSales) ||
      (entry.orders === 0 && entry.totalSales !== "0.00")
    ) {
      throw new Error(
        "Payment breakdown could not be verified. Please refresh.",
      );
    }
    orders += entry.orders;
    cents += BigInt(entry.totalSales.replace(".", ""));
  }
  if (
    orders !== data.completedOrders ||
    cents !== BigInt(data.totalSales.replace(".", ""))
  ) {
    throw new Error(
      "Payment breakdown does not match the sales summary. Please refresh.",
    );
  }
  if (
    !Array.isArray(data.recentOrders) ||
    data.recentOrders.length !== Math.min(10, data.completedOrders)
  ) {
    throw new Error("Recent orders could not be verified. Please refresh.");
  }
  const ids = new Set<string>();
  const numbers = new Set<string>();
  let recentCents = 0n;
  for (const [index, order] of data.recentOrders.entries()) {
    const previous = data.recentOrders[index - 1];
    if (
      !order ||
      typeof order.id !== "string" ||
      !orderIdPattern.test(order.id) ||
      ids.has(order.id.toLowerCase()) ||
      order.shopId !== shopId ||
      !isOrderNumber(order.orderNumber) ||
      numbers.has(order.orderNumber) ||
      order.status !== "CONFIRMED" ||
      order.paymentStatus !== "PAID" ||
      order.preparationStatus !== "COMPLETED" ||
      order.currency !== "PHP" ||
      !isOrderTotal(order.totalPrice) ||
      !isReceiptTimestamp(order.completedAt) ||
      Date.parse(order.completedAt) < Date.parse(bounds.from) ||
      Date.parse(order.completedAt) >= Date.parse(bounds.to) ||
      (previous &&
        (Date.parse(order.completedAt) > Date.parse(previous.completedAt) ||
          (Date.parse(order.completedAt) === Date.parse(previous.completedAt) &&
            order.id > previous.id)))
    ) {
      throw new Error("Recent orders could not be verified. Please refresh.");
    }
    ids.add(order.id.toLowerCase());
    numbers.add(order.orderNumber);
    recentCents += BigInt(order.totalPrice.replace(".", ""));
  }
  if (
    recentCents > cents ||
    (data.recentOrders.length === data.completedOrders && recentCents !== cents)
  ) {
    throw new Error(
      "Recent orders do not match the sales summary. Please refresh.",
    );
  }
  return data;
}
