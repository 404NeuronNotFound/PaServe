import { Prisma } from '../../generated/prisma/client.js';
import { ShopsService } from './shops.service.js';
import { ShopsRepository } from './shops.repository.js';

describe('ShopsService creation', () => {
  const repository = { createWithOwner: vi.fn() };
  const service = new ShopsService(repository as unknown as ShopsRepository);
  const record = {
    id: 'shop-id',
    name: 'Café North',
    slug: 'cafe-north',
    description: null,
    isActive: true,
    createdAt: new Date('2026-10-09T00:00:00Z'),
    members: [{ id: 'membership-id', shopId: 'shop-id', role: 'OWNER' }],
  };
  const uniqueError = (target: string[]) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: { target },
    });
  beforeEach(() => {
    vi.resetAllMocks();
    repository.createWithOwner.mockResolvedValue(record);
  });
  it('normalizes fields and returns a safe shop and creator membership', async () => {
    const result = await service.create('user-id', {
      name: ' Café North ',
      description: '  ',
    });
    expect(repository.createWithOwner).toHaveBeenCalledWith(
      'user-id',
      'Café North',
      'cafe-north',
      null,
    );
    expect(result).toEqual({
      shop: {
        id: record.id,
        name: record.name,
        slug: record.slug,
        description: null,
        isActive: true,
        createdAt: record.createdAt.toISOString(),
      },
      membership: {
        ...record.members[0],
        shop: {
          id: record.id,
          name: record.name,
          slug: record.slug,
          isActive: true,
        },
      },
    });
  });
  it.each([
    ['茶馆', 'shop'],
    ['API', 'api-shop'],
    ['---', 'shop'],
    ['A & B', 'a-b'],
  ])('handles slug base for %s', async (name, slug) => {
    await service.create('user-id', { name });
    expect(repository.createWithOwner).toHaveBeenCalledWith(
      'user-id',
      name,
      slug,
      null,
    );
  });
  it('retries an atomic write with a new slug after a concurrent collision', async () => {
    repository.createWithOwner.mockRejectedValueOnce(uniqueError(['slug']));
    await service.create('user-id', {
      name: 'Café North',
      description: ' Fresh coffee ',
    });
    expect(repository.createWithOwner).toHaveBeenNthCalledWith(
      2,
      'user-id',
      'Café North',
      expect.stringMatching(/^cafe-north-[a-f0-9]{8}$/),
      'Fresh coffee',
    );
  });
  it('bounds retries for repeated slug collisions', async () => {
    repository.createWithOwner.mockRejectedValue(uniqueError(['slug']));
    await expect(
      service.create('user-id', { name: 'Café North' }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'SHOP_SLUG_UNAVAILABLE' },
    });
    expect(repository.createWithOwner).toHaveBeenCalledTimes(5);
  });
  it('handles the installed PostgreSQL adapter unique constraint metadata', async () => {
    repository.createWithOwner.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: {
          driverAdapterError: {
            cause: { constraint: { index: 'shops_slug_key' } },
          },
        },
      }),
    );
    await service.create('user-id', { name: 'Café North' });
    expect(repository.createWithOwner).toHaveBeenCalledTimes(2);
  });
  it.each([
    new Error('Membership write failed'),
    uniqueError(['userId', 'shopId']),
  ])('does not retry unrelated write failures', async (error) => {
    repository.createWithOwner.mockRejectedValue(error);
    await expect(
      service.create('user-id', { name: 'Café North' }),
    ).rejects.toBe(error);
    expect(repository.createWithOwner).toHaveBeenCalledTimes(1);
  });
});
