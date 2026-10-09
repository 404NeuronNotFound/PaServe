import {
  SHOP_PERMISSIONS,
  hasShopPermission,
  isShopOwner,
  type ShopPermission,
  type ShopRole,
} from '@paserve/contracts';

describe('shop OWNER authorization policy', () => {
  it.each(SHOP_PERMISSIONS)('grants OWNER %s', (permission) => {
    expect(hasShopPermission('OWNER', permission)).toBe(true);
  });

  it.each(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'] as const)(
    'does not implicitly grant %s the owner permissions',
    (role) => {
      expect(isShopOwner(role)).toBe(false);
      for (const permission of SHOP_PERMISSIONS)
        expect(hasShopPermission(role, permission)).toBe(false);
    },
  );

  it('recognizes only the exact OWNER role and rejects unknown runtime roles', () => {
    expect(isShopOwner('OWNER')).toBe(true);
    for (const role of ['owner', 'SUPER_ADMIN', '', undefined, null]) {
      expect(isShopOwner(role as ShopRole)).toBe(false);
      expect(hasShopPermission(role as ShopRole, 'shop.billing.manage')).toBe(false);
    }
  });

  it('denies unknown permissions even for OWNER', () => {
    expect(hasShopPermission('OWNER', 'platform.manage' as ShopPermission)).toBe(false);
  });
});
