import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PublicMenuRepository } from './public-menu.repository.js';
import { PublicMenuCache } from './public-menu-cache.js';

const failure = (code = 'P2021', modelName = 'MenuCacheState') =>
  new Prisma.PrismaClientKnownRequestError('private diagnostic', {
    code,
    clientVersion: 'test',
    meta: { modelName },
  });
function fixture() {
  const prisma = {
    shop: {
      findFirst: vi
        .fn()
        .mockImplementation(
          async (args: { select: Record<string, unknown> }) =>
            args.select.id ? { id: 'shop-a' } : { name: 'Cafe', slug: 'cafe' },
        ),
    },
    menuCacheState: { findUnique: vi.fn() },
    category: { findMany: vi.fn().mockResolvedValue([]) },
    product: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          {
            id: 'product-a',
            createdAt: new Date(0),
            price: new Prisma.Decimal('10.00'),
          },
        ]),
    },
  };
  const cache = new PublicMenuCache(new ConfigService());
  const repository = new PublicMenuRepository(
    prisma as unknown as PrismaService,
    cache,
  );
  const warning = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});
  return { prisma, cache, repository, warning };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('public menu cache schema availability', () => {
  it('serves live tenant-scoped rows when the optional cache table is missing, without cache filling or repeated probes/logs', async () => {
    const { prisma, cache, repository, warning } = fixture();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    prisma.menuCacheState.findUnique.mockRejectedValue(failure());
    await cache.getOrLoad('old-version', async () => 'old');
    expect((await repository.read('cafe'))?.products[0].id).toBe('product-a');
    expect((await repository.read('cafe'))?.products[0].price.toFixed(2)).toBe(
      '10.00',
    );
    expect(prisma.menuCacheState.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopId: 'shop-a',
          shop: { id: 'shop-a', slug: 'cafe', isActive: true },
          isArchived: false,
        }),
        take: 101,
      }),
    );
    expect(cache.snapshot().entries).toBe(0);
    vi.setSystemTime(31001);
    await repository.read('cafe');
    expect(prisma.menuCacheState.findUnique).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(1);
    cache.onModuleDestroy();
  });
  it('automatically resumes versioned caching after the migration becomes available', async () => {
    const { prisma, cache, repository } = fixture();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    prisma.menuCacheState.findUnique
      .mockRejectedValueOnce(failure())
      .mockResolvedValue({ version: 'new-epoch' });
    await repository.read('cafe');
    vi.setSystemTime(31001);
    await repository.read('cafe');
    await repository.read('cafe');
    expect(prisma.menuCacheState.findUnique).toHaveBeenCalledTimes(3);
    expect(prisma.product.findMany).toHaveBeenCalledTimes(2);
    expect(cache.snapshot()).toMatchObject({ entries: 1, hits: 1 });
    cache.onModuleDestroy();
  });
  it.each([
    ['P2021', 'Product'],
    ['P2022', 'MenuCacheState'],
    ['P2024', 'MenuCacheState'],
    ['P2010', 'MenuCacheState'],
  ])(
    'preserves unrelated or operational failures %s/%s',
    async (code, model) => {
      const { prisma, cache, repository, warning } = fixture();
      const error = failure(code, model);
      prisma.menuCacheState.findUnique.mockRejectedValue(error);
      await expect(repository.read('cafe')).rejects.toBe(error);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(warning).not.toHaveBeenCalled();
      cache.onModuleDestroy();
    },
  );
});
