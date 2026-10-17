import { BadRequestException } from '@nestjs/common';
import {
  SHOP_ROLES,
  rolesForShopPermissions,
  type ShopRole,
  type ShopPermission,
} from '@paserve/contracts';
import { isUUID } from 'class-validator';

/** Fail closed before constructing a Prisma filter; never allow omitted shop IDs. */
export function shopAccessWhere(
  userId: string,
  shopId: string,
  roles?: readonly ShopRole[],
) {
  if (
    !isUUID(userId) ||
    !isUUID(shopId) ||
    (roles !== undefined &&
      (!Array.isArray(roles) ||
        !roles.length ||
        !Array.from(roles).every((role) => SHOP_ROLES.includes(role))))
  )
    throw new BadRequestException({
      code: 'INVALID_TENANT_CONTEXT',
      message: 'A valid user and shop context are required.',
    });
  return {
    id: shopId,
    isActive: true,
    members: {
      some: {
        userId,
        disabledAt: null,
        ...(roles
          ? { role: roles.length === 1 ? roles[0] : { in: [...roles] } }
          : {}),
        user: { isActive: true },
      },
    },
  };
}

/** Write-time authorization uses the same permission matrix as route guards. */
export function shopPermissionWhere(
  userId: string,
  shopId: string,
  ...permissions: readonly ShopPermission[]
) {
  return shopAccessWhere(
    userId,
    shopId,
    rolesForShopPermissions(...permissions),
  );
}
