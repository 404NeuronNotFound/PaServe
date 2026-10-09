import {
  SHOP_CASHIER_PERMISSIONS,
  SHOP_OPERATIONAL_PERMISSIONS,
  hasShopPermission,
  type ShopPermission,
} from '@paserve/contracts';
import { ShopMembersService } from './shop-members.service.js';
import type { ShopMembersRepository } from './shop-members.repository.js';

describe('shop CASHIER authorization', () => {
  const shopId = 'a0408a16-44c4-4eb4-a438-52c791a216be';
  const otherShopId = 'b0408a16-44c4-4eb4-a438-52c791a216be';
  const repository = { findMembership: vi.fn() };
  const service = new ShopMembersService(
    repository as unknown as ShopMembersRepository,
  );
  const membership = {
    id: 'cashier-membership',
    shopId,
    role: 'CASHIER',
    user: { isActive: true },
    shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
  };
  beforeEach(() => {
    vi.resetAllMocks();
    repository.findMembership.mockResolvedValue(membership);
  });

  it.each(SHOP_CASHIER_PERMISSIONS)(
    'permits CASHIER %s in the target shop',
    async (permission) => {
      await expect(
        service.requirePermission('user-id', shopId, permission),
      ).resolves.toMatchObject({ role: 'CASHIER', shopId });
      expect(repository.findMembership).toHaveBeenCalledWith('user-id', shopId);
    },
  );

  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)(
    'explicitly allows %s the front-counter actions',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      for (const permission of SHOP_CASHIER_PERMISSIONS)
        await expect(
          service.requirePermission('user-id', shopId, permission),
        ).resolves.toMatchObject({ role, shopId });
    },
  );

  it.each([
    ...SHOP_OPERATIONAL_PERMISSIONS,
    'shop.operations.manage',
    'shop.settings.manage',
    'shop.ownership.manage',
    'shop.billing.manage',
  ] as const)('denies CASHIER %s', async (permission) => {
    await expect(
      service.requirePermission('user-id', shopId, permission),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHOP_PERMISSION_REQUIRED' },
    });
  });

  it.each(['KITCHEN', 'cashier', 'SUPER_ADMIN', '', null, undefined])(
    'denies front-counter authority to %s',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      for (const permission of SHOP_CASHIER_PERMISSIONS)
        await expect(
          service.requirePermission('user-id', shopId, permission),
        ).rejects.toMatchObject({ status: 403 });
    },
  );

  it.each([
    null,
    { ...membership, user: { isActive: false } },
    { ...membership, shop: { ...membership.shop, isActive: false } },
  ])(
    'denies absent or inactive contexts before granting counter access',
    async (record) => {
      repository.findMembership.mockResolvedValue(record);
      await expect(
        service.requirePermission('user-id', shopId, 'shop.orders.read'),
      ).rejects.toMatchObject({ status: 404 });
    },
  );

  it('does not authorize a QR/payment action in another shop without membership', async () => {
    repository.findMembership.mockImplementation(
      async (_userId: string, target: string) =>
        target === shopId ? membership : null,
    );
    await service.requirePermission('user-id', shopId, 'shop.orders.qr.scan');
    await expect(
      service.requirePermission('user-id', otherShopId, 'shop.payments.record'),
    ).rejects.toMatchObject({ status: 404 });
    expect(repository.findMembership).toHaveBeenLastCalledWith(
      'user-id',
      otherShopId,
    );
  });

  it('uses the KITCHEN role in another shop despite being CASHIER here', async () => {
    repository.findMembership.mockImplementation(
      async (_userId: string, target: string) =>
        target === shopId
          ? membership
          : {
              ...membership,
              shopId: otherShopId,
              role: 'KITCHEN',
              shop: { ...membership.shop, id: otherShopId },
            },
    );
    await service.requirePermission('user-id', shopId, 'shop.orders.confirm');
    await expect(
      service.requirePermission('user-id', otherShopId, 'shop.orders.confirm'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects counter access after the current membership role changes', async () => {
    await service.requirePermission(
      'user-id',
      shopId,
      'shop.menu.availability.update',
    );
    repository.findMembership.mockResolvedValue({
      ...membership,
      role: 'KITCHEN',
    });
    await expect(
      service.requirePermission(
        'user-id',
        shopId,
        'shop.menu.availability.update',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    'shop.payments.refund',
    'shop.menu.prices.update',
    'platform.manage',
  ])('does not infer an unconfigured sensitive action (%s)', (permission) => {
    expect(hasShopPermission('CASHIER', permission as ShopPermission)).toBe(
      false,
    );
  });

  it('rejects malformed targets before reading memberships', async () => {
    await expect(
      service.requirePermission('user-id', '../other', 'shop.orders.reject'),
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.findMembership).not.toHaveBeenCalled();
  });
});
