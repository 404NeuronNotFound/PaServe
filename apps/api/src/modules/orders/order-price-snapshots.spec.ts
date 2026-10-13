import type { ProductSelectionQuoteResponse } from '@paserve/contracts';
import { copyPriceSnapshot } from './order-price-snapshots.js';

const quote = (): ProductSelectionQuoteResponse => ({
  productId: 'coffee',
  productName: 'Coffee',
  currency: 'PHP',
  basePrice: '0.10',
  unitPrice: '0.60',
  totalPrice: '1.80',
  quantity: 3,
  variants: [
    {
      id: 'large',
      name: 'Large',
      optionGroupId: 'size',
      isDefault: false,
      priceAdjustment: '0.20',
    },
  ],
  addOns: [{ id: 'milk', name: 'Oat milk', priceAdjustment: '0.30' }],
});
it('copies option names/prices independently of subsequent source-object edits', () => {
  const source = quote();
  const saved = copyPriceSnapshot(source);
  source.productName = 'Renamed';
  source.basePrice = '99.00';
  source.variants[0].name = 'Renamed size';
  source.variants[0].priceAdjustment = '99.00';
  source.addOns[0].name = 'Renamed milk';
  source.addOns[0].priceAdjustment = '99.00';
  expect(saved).toEqual(quote());
});
it.each([{ unitPrice: '0.61' }, { totalPrice: '1.79' }])(
  'rejects inconsistent server snapshot arithmetic: %j',
  (fields) => {
    expect(() => copyPriceSnapshot({ ...quote(), ...fields })).toThrow(
      'Invalid server price snapshot.',
    );
  },
);

it.each([
  [
    'empty product name',
    (value: ProductSelectionQuoteResponse) => {
      value.productName = '';
    },
  ],
  [
    'zero quantity',
    (value: ProductSelectionQuoteResponse) => {
      value.quantity = 0;
      value.totalPrice = '0.00';
    },
  ],
  [
    'unsafe note',
    (value: ProductSelectionQuoteResponse) => {
      value.notes = 'Coffee\u202e';
    },
  ],
  [
    'overlong note',
    (value: ProductSelectionQuoteResponse) => {
      value.notes = 'x'.repeat(301);
    },
  ],
  [
    'duplicate add-on',
    (value: ProductSelectionQuoteResponse) => {
      value.addOns.push({ ...value.addOns[0] });
      value.unitPrice = '0.90';
      value.totalPrice = '2.70';
    },
  ],
  [
    'duplicate variant group',
    (value: ProductSelectionQuoteResponse) => {
      value.variants.push({ ...value.variants[0], id: 'other-size' });
      value.unitPrice = '0.80';
      value.totalPrice = '2.40';
    },
  ],
  [
    'negative adjustment',
    (value: ProductSelectionQuoteResponse) => {
      value.variants[0].priceAdjustment = '-0.20';
      value.unitPrice = '0.20';
      value.totalPrice = '0.60';
    },
  ],
  [
    'noncanonical money',
    (value: ProductSelectionQuoteResponse) => {
      value.addOns[0].priceAdjustment = '3e-1';
    },
  ],
  [
    'empty modifier name',
    (value: ProductSelectionQuoteResponse) => {
      value.addOns[0].name = '';
    },
  ],
] as const)('rejects malformed snapshot metadata: %s', (_label, corrupt) => {
  const value = quote();
  corrupt(value);
  expect(() => copyPriceSnapshot(value)).toThrow(
    'Invalid server price snapshot.',
  );
});
