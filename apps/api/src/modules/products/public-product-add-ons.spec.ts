import { ADD_ON_LIMITS } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PublicProductService } from './public-product.service.js';
import { PublicProductRepository } from './public-product.repository.js';

describe('internal selection pricing add-on limit', () => {
  it('accepts the allowed maximum and rejects an oversized eligible selection without DTO validation', async () => {
    const addOns = Array.from(
      { length: ADD_ON_LIMITS.selectionMax + 1 },
      (_, index) => ({
        addOn: {
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          name: `Choice ${index}`,
          priceAdjustment: new Prisma.Decimal('1.00'),
        },
      }),
    );
    const repository = {
      readPricing: vi.fn().mockResolvedValue({
        id: 'product',
        name: 'Coffee',
        price: new Prisma.Decimal('10.00'),
        status: 'AVAILABLE',
        optionGroups: [],
        variants: [],
        addOns,
      }),
    };
    const service = new PublicProductService(
      repository as unknown as PublicProductRepository,
    );
    const selection = {
      variantIds: [],
      addOnIds: addOns
        .slice(0, ADD_ON_LIMITS.selectionMax)
        .map(({ addOn }) => addOn.id),
      quantity: 2,
    };
    const maximum = await service.quote('cafe', 'product', selection);
    expect(maximum.addOns).toHaveLength(ADD_ON_LIMITS.selectionMax);
    expect(maximum.totalPrice).toBe('120.00');
    await expect(
      service.quote('cafe', 'product', {
        ...selection,
        addOnIds: addOns.map(({ addOn }) => addOn.id),
      }),
    ).rejects.toMatchObject({
      response: { code: 'PRODUCT_SELECTION_INVALID' },
    });
  });
});
