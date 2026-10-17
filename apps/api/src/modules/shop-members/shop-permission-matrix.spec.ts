import {
  SHOP_PERMISSIONS,
  SHOP_PERMISSION_MATRIX,
  SHOP_ROLES,
  hasShopPermission,
  rolesForShopPermissions,
  type ShopPermission,
  type ShopRole,
} from '@paserve/contracts';

// Independent policy expectations: changes here require an explicit policy review.
const management: ShopRole[] = ['OWNER', 'ADMIN', 'MANAGER'];
const counter: ShopRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
const preparation: ShopRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN'];
const expected: Record<ShopPermission, readonly ShopRole[]> = {
  'shop.menu.manage': management,
  'shop.orders.manage': management,
  'shop.reports.read': management,
  'shop.daily-operations.manage': management,
  'shop.orders.qr.scan': counter,
  'shop.orders.read': counter,
  'shop.payments.record': counter,
  'shop.orders.confirm': counter,
  'shop.orders.reject': counter,
  'shop.menu.availability.update': counter,
  'shop.preparation.queue.read': preparation,
  'shop.preparation.status.update': preparation,
  'shop.operations.manage': ['OWNER', 'ADMIN'],
  'shop.settings.manage': ['OWNER'],
  'shop.ownership.manage': ['OWNER'],
  'shop.billing.manage': ['OWNER'],
  'shop.staff.manage': ['OWNER'],
  'shop.orders.overview.read': ['OWNER'],
};

describe('complete shop authorization matrix', () => {
  it.each(SHOP_PERMISSIONS)(
    'keeps %s at its exact reviewed role boundary',
    (permission) => {
      expect(rolesForShopPermissions(permission)).toEqual(expected[permission]);
      for (const role of SHOP_ROLES)
        expect(hasShopPermission(role, permission)).toBe(
          expected[permission].includes(role),
        );
    },
  );

  it('requires every permission rather than any permission', () => {
    expect(
      rolesForShopPermissions(
        'shop.orders.read',
        'shop.preparation.queue.read',
      ),
    ).toEqual(management);
    expect(
      rolesForShopPermissions('shop.staff.manage', 'shop.payments.record'),
    ).toEqual(['OWNER']);
  });

  it('fails closed for absent, unknown, and prototype permission/role values', () => {
    expect(rolesForShopPermissions()).toEqual([]);
    for (const permission of [
      '*',
      'platform.manage',
      '__proto__',
      undefined,
      null,
    ] as unknown as ShopPermission[]) {
      expect(rolesForShopPermissions(permission)).toEqual([]);
      expect(rolesForShopPermissions('shop.orders.read', permission)).toEqual(
        [],
      );
      for (const role of SHOP_ROLES)
        expect(hasShopPermission(role, permission)).toBe(false);
    }
    for (const role of [
      'SUPER_ADMIN',
      '__proto__',
      'constructor',
      undefined,
      null,
    ] as unknown as ShopRole[])
      for (const permission of SHOP_PERMISSIONS)
        expect(hasShopPermission(role, permission)).toBe(false);
  });

  it('keeps matrix rows immutable and free of unknown or duplicate grants', () => {
    expect(Object.isFrozen(SHOP_PERMISSION_MATRIX)).toBe(true);
    for (const role of SHOP_ROLES) {
      expect(Object.isFrozen(SHOP_PERMISSION_MATRIX[role])).toBe(true);
      expect(new Set(SHOP_PERMISSION_MATRIX[role]).size).toBe(
        SHOP_PERMISSION_MATRIX[role].length,
      );
      for (const permission of SHOP_PERMISSION_MATRIX[role])
        expect(SHOP_PERMISSIONS).toContain(permission);
    }
  });
});
