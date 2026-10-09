import {
  SHOP_OPERATIONAL_PERMISSIONS,
  hasShopPermission,
  type ShopPermission,
} from '@paserve/contracts';
import { ShopMembersService } from './shop-members.service.js';
import type { ShopMembersRepository } from './shop-members.repository.js';

describe('shop MANAGER authorization', () => {
  const shopId = 'a0408a16-44c4-4eb4-a438-52c791a216be';
  const otherShopId = 'b0408a16-44c4-4eb4-a438-52c791a216be';
  const repository = { findMembership: vi.fn() };
  const service = new ShopMembersService(
    repository as unknown as ShopMembersRepository,
  );
  const membership = {
    id: 'manager-membership',
    shopId,
    role: 'MANAGER',
    user: { isActive: true },
    shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
  };
  beforeEach(() => {
    vi.resetAllMocks();
    repository.findMembership.mockResolvedValue(membership);
  });

  it.each(SHOP_OPERATIONAL_PERMISSIONS)(
    'permits MANAGER %s in their shop',
    async (permission) => {
      await expect(
        service.requirePermission('user-id', shopId, permission),
      ).resolves.toMatchObject({ role: 'MANAGER', shopId });
      expect(repository.findMembership).toHaveBeenCalledWith('user-id', shopId);
    },
  );

  it.each(['OWNER', 'ADMIN'] as const)(
    'retains %s access to every daily-operation grant',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      for (const permission of SHOP_OPERATIONAL_PERMISSIONS)
        await expect(
          service.requirePermission('user-id', shopId, permission),
        ).resolves.toMatchObject({ role, shopId });
    },
  );

  it.each([
    'shop.operations.manage',
    'shop.settings.manage',
    'shop.ownership.manage',
    'shop.billing.manage',
  ] as const)('denies MANAGER %s', async (permission) => {
    await expect(
      service.requirePermission('user-id', shopId, permission),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHOP_PERMISSION_REQUIRED' },
    });
  });

  it.each(['CASHIER', 'KITCHEN'])(
    'does not grant %s manager authority',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      for (const permission of SHOP_OPERATIONAL_PERMISSIONS)
        await expect(
          service.requirePermission('user-id', shopId, permission),
        ).rejects.toMatchObject({ status: 403 });
    },
  );

  it('does not carry manager authority into a shop with no membership', async () => {
    repository.findMembership.mockImplementation(
      async (_userId: string, target: string) =>
        target === shopId ? membership : null,
    );
    await service.requirePermission('user-id', shopId, 'shop.menu.manage');
    await expect(
      service.requirePermission('user-id', otherShopId, 'shop.menu.manage'),
    ).rejects.toMatchObject({ status: 404 });
    expect(repository.findMembership).toHaveBeenLastCalledWith(
      'user-id',
      otherShopId,
    );
  });

  it('uses the lower role in the target shop despite managing another shop', async () => {
    repository.findMembership.mockImplementation(
      async (_userId: string, target: string) =>
        target === shopId
          ? membership
          : {
              ...membership,
              shopId: otherShopId,
              role: 'CASHIER',
              shop: { ...membership.shop, id: otherShopId },
            },
    );
    await service.requirePermission('user-id', shopId, 'shop.orders.manage');
    await expect(
      service.requirePermission('user-id', otherShopId, 'shop.orders.manage'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    null,
    { ...membership, user: { isActive: false } },
    { ...membership, shop: { ...membership.shop, isActive: false } },
  ])('denies missing or inactive contexts', async (record) => {
    repository.findMembership.mockResolvedValue(record);
    await expect(
      service.requirePermission('user-id', shopId, 'shop.reports.read'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects operational access after a live role downgrade', async () => {
    await service.requirePermission(
      'user-id',
      shopId,
      'shop.daily-operations.manage',
    );
    repository.findMembership.mockResolvedValue({
      ...membership,
      role: 'KITCHEN',
    });
    await expect(
      service.requirePermission(
        'user-id',
        shopId,
        'shop.daily-operations.manage',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(['manager', 'SUPER_ADMIN', '__proto__', '', null, undefined])(
    'rejects unknown runtime roles (%s)',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      await expect(
        service.requirePermission('user-id', shopId, 'shop.menu.manage'),
      ).rejects.toMatchObject({ status: 403 });
    },
  );

  it('rejects unknown permissions even for management roles', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const)
      expect(hasShopPermission(role, 'platform.manage' as ShopPermission)).toBe(
        false,
      );
  });

  it('rejects malformed shop IDs before reading memberships', async () => {
    await expect(
      service.requirePermission('user-id', '../other', 'shop.menu.manage'),
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.findMembership).not.toHaveBeenCalled();
  });
});
