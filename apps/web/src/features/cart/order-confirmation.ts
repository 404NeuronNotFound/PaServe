import {
  normalizeCustomerNote,
  type CreateCustomerOrderRequest,
  type CustomerOrderResponse,
} from "@paserve/contracts";
import { parseCartLine } from "./cart-storage";
import { sumPrices } from "./cart";
import { isPublicTableContext } from "../shops/customer-table";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const sameIds = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
/** Do not clear a cart for an incomplete or mismatched success response. */
export function isCreatedOrderResponse(
  value: unknown,
  request: CreateCustomerOrderRequest,
  shopSlug: string,
): value is CustomerOrderResponse {
  if (!record(value) || !record(value.order)) return false;
  const order = value.order;
  if (
    typeof order.id !== "string" ||
    !order.id ||
    order.id.length > 100 ||
    order.status !== "PENDING" ||
    order.mode !== (request.mode ?? "DINE_IN") ||
    order.currency !== "PHP" ||
    typeof order.totalPrice !== "string" ||
    !/^\d{1,10}\.\d{2}$/.test(order.totalPrice) ||
    typeof order.createdAt !== "string" ||
    !Number.isFinite(Date.parse(order.createdAt)) ||
    !Array.isArray(order.items) ||
    !order.items.length ||
    order.items.length !== request.items.length ||
    order.items.length > 100
  )
    return false;
  if (
    order.mode === "TAKEOUT"
      ? order.table !== null
      : !isPublicTableContext(order.table) ||
        order.table.shopSlug !== shopSlug ||
        order.table.code !== request.tableCode
  )
    return false;
  const totals: string[] = [];
  for (let index = 0; index < order.items.length; index++) {
    const raw = order.items[index];
    if (!record(raw)) return false;
    const item = parseCartLine({ ...raw, lineId: `confirmed-${index}` });
    const selected = request.items[index];
    if (
      !item ||
      item.productId !== selected.productId ||
      item.quantity !== selected.quantity ||
      item.notes !==
        (normalizeCustomerNote(selected.notes ?? "") || undefined) ||
      !sameIds(
        item.variants.map((option) => option.id),
        selected.variantIds,
      ) ||
      !sameIds(
        item.addOns.map((option) => option.id),
        selected.addOnIds,
      ) ||
      sumPrices([
        item.basePrice,
        ...item.variants.map((option) => option.priceAdjustment),
        ...item.addOns.map((option) => option.priceAdjustment),
      ]) !== item.unitPrice
    )
      return false;
    totals.push(item.totalPrice);
  }
  const subtotal = sumPrices(totals);
  return (
    subtotal === order.totalPrice &&
    (order.subtotalPrice === undefined || order.subtotalPrice === subtotal)
  );
}
