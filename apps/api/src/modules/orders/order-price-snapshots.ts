import {
  CUSTOMER_NOTE_MAX_LENGTH,
  CUSTOMER_NOTE_PATTERN,
  PRODUCT_CURRENCY,
  type ProductSelectionQuoteResponse,
} from '@paserve/contracts';
import { Prisma, type OrderItem } from '../../generated/prisma/client.js';

const snapshotText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1000;
const snapshotMoney = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:0|[1-9]\d{0,15})\.\d{2}$/.test(value);

/** Copy only server-priced receipt fields, with no mutable menu object references. */
export function copyPriceSnapshot(
  quote: ProductSelectionQuoteResponse,
): ProductSelectionQuoteResponse {
  // Saved JSON is not guaranteed to retain the typed quote's shape. Apply the
  // same receipt constraints used by the cashier before review or confirmation.
  if (
    !snapshotText(quote.productId) ||
    !snapshotText(quote.productName) ||
    !Number.isInteger(quote.quantity) ||
    quote.quantity < 1 ||
    quote.quantity > 99 ||
    !snapshotMoney(quote.basePrice) ||
    !snapshotMoney(quote.unitPrice) ||
    !snapshotMoney(quote.totalPrice) ||
    (quote.notes !== undefined &&
      (typeof quote.notes !== 'string' ||
        quote.notes.length > CUSTOMER_NOTE_MAX_LENGTH ||
        !CUSTOMER_NOTE_PATTERN.test(quote.notes))) ||
    !Array.isArray(quote.variants) ||
    quote.variants.length > 50 ||
    !Array.isArray(quote.addOns) ||
    quote.addOns.length > 50 ||
    quote.variants.some(
      (option) =>
        !option ||
        !snapshotText(option.id) ||
        !snapshotText(option.name) ||
        !(
          option.optionGroupId === null || snapshotText(option.optionGroupId)
        ) ||
        typeof option.isDefault !== 'boolean' ||
        !snapshotMoney(option.priceAdjustment),
    ) ||
    quote.addOns.some(
      (option) =>
        !option ||
        !snapshotText(option.id) ||
        !snapshotText(option.name) ||
        !snapshotMoney(option.priceAdjustment),
    ) ||
    new Set(quote.variants.map((option) => option.id)).size !==
      quote.variants.length ||
    new Set(quote.variants.map((option) => option.optionGroupId)).size !==
      quote.variants.length ||
    new Set(quote.addOns.map((option) => option.id)).size !==
      quote.addOns.length
  )
    throw new Error('Invalid server price snapshot.');
  const variants = quote.variants.map((option) => ({
    id: option.id,
    name: option.name,
    optionGroupId: option.optionGroupId,
    isDefault: option.isDefault,
    priceAdjustment: option.priceAdjustment,
  }));
  const addOns = quote.addOns.map((option) => ({
    id: option.id,
    name: option.name,
    priceAdjustment: option.priceAdjustment,
  }));
  const unit = [...variants, ...addOns].reduce(
    (sum, option) => sum.plus(option.priceAdjustment),
    new Prisma.Decimal(quote.basePrice),
  );
  if (
    quote.currency !== PRODUCT_CURRENCY ||
    !unit.equals(quote.unitPrice) ||
    !unit.times(quote.quantity).equals(quote.totalPrice)
  )
    throw new Error('Invalid server price snapshot.');
  return {
    productId: quote.productId,
    productName: quote.productName,
    currency: PRODUCT_CURRENCY,
    basePrice: quote.basePrice,
    unitPrice: quote.unitPrice,
    totalPrice: quote.totalPrice,
    quantity: quote.quantity,
    ...(quote.notes !== undefined ? { notes: quote.notes } : {}),
    variants,
    addOns,
  };
}

/** Receipt authority is the persisted snapshot columns. Never fall back to a live
 * product relation, its nullable ID, or the legacy parent/item JSON. Invalid
 * snapshots must fail validation so historical receipts cannot be silently repriced. */
export function readPriceSnapshot(
  item: Pick<
    OrderItem,
    | 'productSnapshotId'
    | 'productNameSnapshot'
    | 'currency'
    | 'quantity'
    | 'notes'
    | 'basePriceSnapshot'
    | 'unitPriceSnapshot'
    | 'lineTotalSnapshot'
    | 'variantsSnapshot'
    | 'addOnsSnapshot'
  >,
): ProductSelectionQuoteResponse {
  return copyPriceSnapshot({
    productId: item.productSnapshotId,
    productName: item.productNameSnapshot,
    currency: item.currency as typeof PRODUCT_CURRENCY,
    quantity: item.quantity,
    ...(item.notes !== null ? { notes: item.notes } : {}),
    basePrice: item.basePriceSnapshot.toFixed(2),
    unitPrice: item.unitPriceSnapshot.toFixed(2),
    totalPrice: item.lineTotalSnapshot.toFixed(2),
    variants:
      item.variantsSnapshot as unknown as ProductSelectionQuoteResponse['variants'],
    addOns:
      item.addOnsSnapshot as unknown as ProductSelectionQuoteResponse['addOns'],
  });
}
