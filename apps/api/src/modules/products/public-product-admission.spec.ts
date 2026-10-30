import { Prisma } from '../../generated/prisma/client.js';
import { PublicMenuReadGate } from '../categories/public-menu-read-gate.js';
import { PublicProductService } from './public-product.service.js';
import type { PublicProductRepository } from './public-product.repository.js';

describe('public detail database admission', () => {
  it('shares menu admission before starting product lookup', async () => {
    const gate = new PublicMenuReadGate();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = Array.from({ length: 4 }, () => gate.run(() => held));
    const read = vi
      .fn()
      .mockResolvedValue({
        id: 'product',
        name: 'Synthetic',
        slug: 'synthetic',
        categoryId: null,
        price: new Prisma.Decimal('10.00'),
        status: 'AVAILABLE',
        optionGroups: [],
        variants: [],
        addOns: [],
      });
    const service = new PublicProductService(
      { read } as unknown as PublicProductRepository,
      gate,
    );
    const detail = service.details('synthetic-shop', 'product');
    expect(gate.snapshot()).toMatchObject({ active: 4, waiting: 1 });
    expect(read).not.toHaveBeenCalled();
    release();
    await Promise.all(active);
    await expect(detail).resolves.toMatchObject({
      product: { id: 'product', price: '10.00', isOrderable: true },
    });
    expect(read).toHaveBeenCalledOnce();
    expect(gate.snapshot()).toMatchObject({ active: 0, waiting: 0 });
  });
});
