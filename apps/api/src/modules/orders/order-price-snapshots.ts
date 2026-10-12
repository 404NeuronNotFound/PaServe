import {
  PRODUCT_CURRENCY,
  type ProductSelectionQuoteResponse,
} from '@paserve/contracts';
import { Prisma, type OrderItem } from '../../generated/prisma/client.js';

/** Copy only server-priced receipt fields, with no mutable menu object references. */
export function copyPriceSnapshot(
  quote: ProductSelectionQuoteResponse,
): ProductSelectionQuoteResponse {
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

export function readPriceSnapshot(
  item: OrderItem,
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
