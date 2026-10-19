import { copyPriceSnapshot } from '../orders/order-price-snapshots.js';
import { PublicProductService } from './public-product.service.js';
import { PublicProductRepository } from './public-product.repository.js';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TableContextService } from '../tables/table-context.service.js';
import { OrderTokenService } from '../orders/order-token.service.js';

const id = '00000000-0000-4000-8000-000000000001';
const selection = { variantIds: [], addOnIds: [], quantity: 1 };
describe('domain input validation without HTTP', () => {
  it('preserves valid Unicode notes through server snapshot validation', () => {
    const quote = {
      productId: id,
      productName: 'Coffee',
      currency: 'PHP' as const,
      basePrice: '1.00',
      unitPrice: '1.00',
      totalPrice: '1.00',
      quantity: 1,
      variants: [],
      addOns: [],
      notes: '\u{1f600}'.repeat(300),
    };
    expect(copyPriceSnapshot(quote).notes).toBe(quote.notes);
    expect(() =>
      copyPriceSnapshot({ ...quote, notes: quote.notes + 'a' }),
    ).toThrow('Invalid server price snapshot.');
  });
  it.each([0, -1, 100, 1.5, NaN, Infinity, '2', true, null])(
    'rejects invalid quantities before pricing or database access: %j',
    async (quantity) => {
      const read = vi.fn();
      const service = new PublicProductService({
        read,
      } as unknown as PublicProductRepository);
      await expect(
        service.quote('cafe', id, { ...selection, quantity } as never),
      ).rejects.toMatchObject({
        response: { code: 'PRODUCT_SELECTION_INVALID' },
      });
      expect(read).not.toHaveBeenCalled();
    },
  );
  it.each([
    { variantIds: null },
    { variantIds: [id, id] },
    { addOnIds: ['invalid'] },
    { notes: '\u0000' },
    { notes: 'a'.repeat(301) },
  ])('rejects malformed selections before pricing: %j', async (overrides) => {
    const read = vi.fn();
    const service = new PublicProductService({
      read,
    } as unknown as PublicProductRepository);
    await expect(
      service.quote('cafe', id, { ...selection, ...overrides } as never),
    ).rejects.toMatchObject({
      response: { code: 'PRODUCT_SELECTION_INVALID' },
    });
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    [],
    Array.from({ length: 101 }, () => ({ ...selection, productId: id })),
    [{ ...selection, quantity: -1, productId: id }],
  ])('rejects invalid internal orders before a transaction', async (items) => {
    const transaction = vi.fn();
    const service = new OrdersService(
      { $transaction: transaction } as unknown as PrismaService,
      {} as PublicProductService,
      {} as TableContextService,
      {} as OrderTokenService,
    );
    await expect(
      service.create('cafe', { requestId: id, mode: 'TAKEOUT', items }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(transaction).not.toHaveBeenCalled();
  });
});
