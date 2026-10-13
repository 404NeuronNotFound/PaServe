import { shopAccessWhere } from './shop-scope.js';
import { TenantResourcesRepository } from './tenant-resources.repository.js';
import { TenantResourcesService } from './tenant-resources.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { ShopMembersService } from '../shop-members/shop-members.service.js';
import type { ShopRole } from '@paserve/contracts';

describe('tenant resource isolation', () => {
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const resourceId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const memberships = { requireMembership: vi.fn() };
  const resources = { findResource: vi.fn() };
  const service = new TenantResourcesService(
    memberships as unknown as ShopMembersService,
    resources as unknown as TenantResourcesRepository,
  );
  beforeEach(() => {
    vi.resetAllMocks();
    memberships.requireMembership.mockResolvedValue({ shopId, role: 'OWNER' });
  });

  it.each(['staffInvitation', 'staffAuditEvent'] as const)(
    'restricts %s resource queries to the target shop and live owner',
    async (kind) => {
      const prisma = {
        staffInvitation: { findFirst: vi.fn() },
        staffAuditEvent: { findFirst: vi.fn() },
      };
      const repo = new TenantResourcesRepository(
        prisma as unknown as PrismaService,
      );
      await repo.findResource(userId, shopId, kind, resourceId);
      expect(prisma[kind].findFirst).toHaveBeenCalledWith({
        where: {
          id: resourceId,
          shopId,
          shop: shopAccessWhere(userId, shopId, ['OWNER']),
        },
        select: { id: true, shopId: true },
      });
    },
  );

  it.each(['product', 'category', 'table', 'order', 'orderItem'] as const)(
    'resolves a %s only using user, shop and resource IDs',
    async (kind) => {
      resources.findResource.mockResolvedValue({ id: resourceId, shopId });
      await expect(
        service.requireResource(userId, shopId, kind, resourceId),
      ).resolves.toMatchObject({ resource: { id: resourceId, shopId, kind } });
      expect(resources.findResource).toHaveBeenCalledWith(
        userId,
        shopId,
        kind,
        resourceId,
      );
      expect(
        memberships.requireMembership.mock.invocationCallOrder[0],
      ).toBeLessThan(resources.findResource.mock.invocationCallOrder[0]);
    },
  );

  it('blocks resource lookup when live membership fails', async () => {
    memberships.requireMembership.mockRejectedValue({ status: 404 });
    await expect(
      service.requireResource(userId, shopId, 'product', resourceId),
    ).rejects.toMatchObject({ status: 404 });
    expect(resources.findResource).not.toHaveBeenCalled();
  });

  it.each(['', 'not-a-uuid', '../resource', undefined, null])(
    'rejects invalid resource IDs (%s)',
    async (id) => {
      await expect(
        service.requireResource(userId, shopId, 'product', id as string),
      ).rejects.toMatchObject({ status: 400 });
      expect(resources.findResource).not.toHaveBeenCalled();
    },
  );

  it('returns the same safe denial for missing or other-shop resources', async () => {
    resources.findResource.mockResolvedValue(null);
    await expect(
      service.requireResource(userId, shopId, 'category', resourceId),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'RESOURCE_NOT_ACCESSIBLE' },
    });
  });

  it('rejects unsupported resource kinds', async () => {
    await expect(
      service.requireResource(
        userId,
        shopId,
        'unknown' as 'product',
        resourceId,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(resources.findResource).not.toHaveBeenCalled();
  });

  it.each(['product', 'category', 'table', 'order', 'orderItem'] as const)(
    'scopes the actual %s query and rechecks live access',
    async (kind) => {
      const prisma = {
        product: { findFirst: vi.fn() },
        category: { findFirst: vi.fn() },
        restaurantTable: { findFirst: vi.fn() },
        order: { findFirst: vi.fn() },
        orderItem: { findFirst: vi.fn() },
      };
      const repo = new TenantResourcesRepository(
        prisma as unknown as PrismaService,
      );
      await repo.findResource(userId, shopId, kind, resourceId);
      expect(
        prisma[kind === 'table' ? 'restaurantTable' : kind].findFirst,
      ).toHaveBeenCalledWith({
        where:
          kind === 'orderItem'
            ? {
                id: resourceId,
                shopId,
                order: { shopId, shop: shopAccessWhere(userId, shopId) },
              }
            : {
                id: resourceId,
                shopId,
                shop: {
                  id: shopId,
                  isActive: true,
                  members: { some: { userId, user: { isActive: true } } },
                },
              },
        select: { id: true, shopId: true },
      });
    },
  );

  it.each(['', undefined, null, 'other-shop'])(
    'does not construct an unscoped filter for invalid shop ID (%s)',
    (id) => {
      expect(() => shopAccessWhere(userId, id as string)).toThrow();
    },
  );

  it('requires a valid actor and rejects an empty role policy', () => {
    expect(() => shopAccessWhere('', shopId)).toThrow();
    expect(() => shopAccessWhere(userId, shopId, [])).toThrow();
  });

  it('preserves exact OWNER restrictions for settings', () => {
    expect(shopAccessWhere(userId, shopId, ['OWNER'])).toMatchObject({
      id: shopId,
      members: { some: { userId, role: 'OWNER' } },
    });
  });

  it.each([
    { roles: null },
    { roles: 'OWNER' },
    { roles: [undefined] },
    { roles: [null] },
    { roles: ['SUPER_ADMIN'] },
    { roles: ['OWNER', undefined] },
    { roles: Array(1) },
  ])('rejects malformed role filters before a query (%j)', ({ roles }) => {
    expect(() =>
      shopAccessWhere(userId, shopId, roles as readonly ShopRole[]),
    ).toThrow();
  });

  it('rejects an omitted resource ID at repository level instead of reading the first row', () => {
    const prisma = {
      product: { findFirst: vi.fn() },
      category: { findFirst: vi.fn() },
      restaurantTable: { findFirst: vi.fn() },
    };
    const repo = new TenantResourcesRepository(
      prisma as unknown as PrismaService,
    );
    expect(() =>
      repo.findResource(
        userId,
        shopId,
        'product',
        undefined as unknown as string,
      ),
    ).toThrow();
    expect(() =>
      repo.findResource(userId, shopId, 'unknown' as 'product', resourceId),
    ).toThrow();
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(prisma.category.findFirst).not.toHaveBeenCalled();
  });
});
