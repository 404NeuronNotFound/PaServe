import { hasShopPermission, type ShopPermission } from '@paserve/contracts';
import { ShopMembersService } from './shop-members.service.js';
import type { ShopMembersRepository } from './shop-members.repository.js';

describe('shop ADMIN authorization', () => {
  const shopId = 'a0408a16-44c4-4eb4-a438-52c791a216be';
  const otherShopId = 'b0408a16-44c4-4eb4-a438-52c791a216be';
  const repository = { findMembership: vi.fn() };
  const service = new ShopMembersService(
    repository as unknown as ShopMembersRepository,
  );
  const membership = {
    id: 'admin-membership',
    shopId,
    role: 'ADMIN',
    user: { isActive: true },
    shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
  };
  beforeEach(() => {
    vi.resetAllMocks();
    repository.findMembership.mockResolvedValue(membership);
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'permits %s to manage shop operations',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      expect(hasShopPermission(role, 'shop.operations.manage')).toBe(true);
      await expect(
        service.requirePermission('user-id', shopId, 'shop.operations.manage'),
      ).resolves.toMatchObject({ shopId, role });
      expect(repository.findMembership).toHaveBeenCalledWith('user-id', shopId);
    },
  );

  it.each([
    'shop.settings.manage',
    'shop.ownership.manage',
    'shop.billing.manage',
  ] as const)('denies ADMIN %s', async (permission) => {
    await expect(
      service.requirePermission('user-id', shopId, permission),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHOP_PERMISSION_REQUIRED' },
    });
  });

  it.each(['MANAGER', 'CASHIER', 'KITCHEN', 'admin', 'SUPER_ADMIN'])(
    'denies operational management for %s',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      await expect(
        service.requirePermission('user-id', shopId, 'shop.operations.manage'),
      ).rejects.toMatchObject({ status: 403 });
    },
  );

  it('uses the requested shop membership, not ADMIN authority in another shop', async () => {
    repository.findMembership.mockImplementation(
      async (_userId: string, target: string) =>
        target === shopId ? membership : null,
    );
    await expect(
      service.requirePermission(
        'user-id',
        otherShopId,
        'shop.operations.manage',
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'SHOP_NOT_ACCESSIBLE' },
    });
    expect(repository.findMembership).toHaveBeenCalledWith(
      'user-id',
      otherShopId,
    );
  });

  it('does not inherit ADMIN authority when only a cashier in the requested shop', async () => {
    repository.findMembership.mockResolvedValue({
      ...membership,
      shopId: otherShopId,
      role: 'CASHIER',
      shop: { ...membership.shop, id: otherShopId },
    });
    await expect(
      service.requirePermission(
        'user-id',
        otherShopId,
        'shop.operations.manage',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    null,
    { ...membership, user: { isActive: false } },
    { ...membership, shop: { ...membership.shop, isActive: false } },
  ])(
    'denies missing or inactive membership before permission evaluation',
    async (record) => {
      repository.findMembership.mockResolvedValue(record);
      await expect(
        service.requirePermission('user-id', shopId, 'shop.operations.manage'),
      ).rejects.toMatchObject({ status: 404 });
    },
  );

  it('checks the live role again after an ADMIN downgrade', async () => {
    await service.requirePermission(
      'user-id',
      shopId,
      'shop.operations.manage',
    );
    repository.findMembership.mockResolvedValue({
      ...membership,
      role: 'CASHIER',
    });
    await expect(
      service.requirePermission('user-id', shopId, 'shop.operations.manage'),
    ).rejects.toMatchObject({ status: 403 });
    expect(repository.findMembership).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown permissions for ADMIN', async () => {
    await expect(
      service.requirePermission(
        'user-id',
        shopId,
        'platform.manage' as ShopPermission,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects malformed targets before reading memberships', async () => {
    await expect(
      service.requirePermission(
        'user-id',
        '../another-shop',
        'shop.operations.manage',
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.findMembership).not.toHaveBeenCalled();
  });
});
