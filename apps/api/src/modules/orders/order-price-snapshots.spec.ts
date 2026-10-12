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
