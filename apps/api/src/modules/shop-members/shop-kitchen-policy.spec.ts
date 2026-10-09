import {
  SHOP_KITCHEN_PERMISSIONS,
  SHOP_CASHIER_PERMISSIONS,
  SHOP_OPERATIONAL_PERMISSIONS,
  PREPARATION_STATUSES,
  canTransitionPreparationStatus,
  type PreparationStatus,
  type ShopPermission,
} from '@paserve/contracts';
import { ShopMembersService } from './shop-members.service.js';
import type { ShopMembersRepository } from './shop-members.repository.js';

describe('shop KITCHEN/barista authorization', () => {
  const shopId = 'a0408a16-44c4-4eb4-a438-52c791a216be';
  const otherShopId = 'b0408a16-44c4-4eb4-a438-52c791a216be';
  const repository = { findMembership: vi.fn() };
  const service = new ShopMembersService(
    repository as unknown as ShopMembersRepository,
  );
  const membership = {
    id: 'kitchen-membership',
    shopId,
    role: 'KITCHEN',
    user: { isActive: true },
    shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
  };
  beforeEach(() => {
    vi.resetAllMocks();
    repository.findMembership.mockResolvedValue(membership);
  });

  it.each(SHOP_KITCHEN_PERMISSIONS)(
    'permits KITCHEN %s in the requested shop',
    async (permission) => {
      await expect(
        service.requirePermission('user-id', shopId, permission),
      ).resolves.toMatchObject({ role: 'KITCHEN', shopId });
      expect(repository.findMembership).toHaveBeenCalledWith('user-id', shopId);
    },
  );

  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)(
    'explicitly grants %s preparation access',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      for (const permission of SHOP_KITCHEN_PERMISSIONS)
        await expect(
          service.requirePermission('user-id', shopId, permission),
        ).resolves.toMatchObject({ role });
    },
  );

  it.each([
    ...SHOP_CASHIER_PERMISSIONS,
    ...SHOP_OPERATIONAL_PERMISSIONS,
    'shop.operations.manage',
    'shop.settings.manage',
    'shop.ownership.manage',
    'shop.billing.manage',
  ] as const)('denies KITCHEN %s', async (permission) => {
    await expect(
      service.requirePermission('user-id', shopId, permission),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHOP_PERMISSION_REQUIRED' },
    });
  });

  it('does not grant CASHIER preparation permissions', async () => {
    repository.findMembership.mockResolvedValue({
      ...membership,
      role: 'CASHIER',
    });
    for (const permission of SHOP_KITCHEN_PERMISSIONS)
      await expect(
        service.requirePermission('user-id', shopId, permission),
      ).rejects.toMatchObject({ status: 403 });
  });

  it('does not carry queue access into another shop with no membership', async () => {
    repository.findMembership.mockImplementation(
      async (_userId: string, target: string) =>
        target === shopId ? membership : null,
    );
    await service.requirePermission(
      'user-id',
      shopId,
      'shop.preparation.queue.read',
    );
    await expect(
      service.requirePermission(
        'user-id',
        otherShopId,
        'shop.preparation.queue.read',
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(repository.findMembership).toHaveBeenLastCalledWith(
      'user-id',
      otherShopId,
    );
  });

  it('uses the actual role in the target shop', async () => {
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
        'shop.preparation.status.update',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    null,
    { ...membership, user: { isActive: false } },
    { ...membership, shop: { ...membership.shop, isActive: false } },
  ])('denies removed or inactive contexts', async (record) => {
    repository.findMembership.mockResolvedValue(record);
    await expect(
      service.requirePermission(
        'user-id',
        shopId,
        'shop.preparation.queue.read',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rechecks the live role before a preparation update', async () => {
    await service.requirePermission(
      'user-id',
      shopId,
      'shop.preparation.queue.read',
    );
    repository.findMembership.mockResolvedValue({
      ...membership,
      role: 'CASHIER',
    });
    await expect(
      service.requirePreparationTransition(
        'user-id',
        shopId,
        'QUEUED',
        'PREPARING',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(
    PREPARATION_STATUSES.flatMap((from) =>
      PREPARATION_STATUSES.map((to) => [from, to] as const),
    ),
  )('enforces preparation transition %s -> %s', async (from, to) => {
    const allowed =
      (from === 'QUEUED' && to === 'PREPARING') ||
      (from === 'PREPARING' && to === 'READY');
    expect(canTransitionPreparationStatus(from, to)).toBe(allowed);
    const check = service.requirePreparationTransition(
      'user-id',
      shopId,
      from,
      to,
    );
    if (allowed)
      await expect(check).resolves.toMatchObject({ shopId, role: 'KITCHEN' });
    else
      await expect(check).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_PREPARATION_TRANSITION' },
      });
  });

  it.each([
    'CONFIRMED',
    'REJECTED',
    'PAID',
    'CANCELLED',
    'COMPLETED',
    'ready',
    null,
    undefined,
  ])('rejects non-preparation targets (%s)', async (target) => {
    await expect(
      service.requirePreparationTransition(
        'user-id',
        shopId,
        'PREPARING',
        target as PreparationStatus,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an unknown source state', async () => {
    await expect(
      service.requirePreparationTransition(
        'user-id',
        shopId,
        'UNKNOWN' as PreparationStatus,
        'READY',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(['kitchen', 'BARISTA', 'SUPER_ADMIN', '', null, undefined])(
    'does not trust unknown role labels (%s)',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...membership, role });
      await expect(
        service.requirePermission(
          'user-id',
          shopId,
          'shop.preparation.queue.read',
        ),
      ).rejects.toMatchObject({ status: 403 });
    },
  );

  it('rejects unknown permissions', async () => {
    await expect(
      service.requirePermission(
        'user-id',
        shopId,
        'shop.orders.complete' as ShopPermission,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects malformed shop IDs before database access', async () => {
    await expect(
      service.requirePreparationTransition(
        'user-id',
        '../other',
        'QUEUED',
        'PREPARING',
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.findMembership).not.toHaveBeenCalled();
  });
});
