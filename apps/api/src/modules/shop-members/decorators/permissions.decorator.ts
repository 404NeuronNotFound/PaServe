import { applyDecorators, SetMetadata } from '@nestjs/common';
import {
  rolesForShopPermissions,
  type ShopPermission,
} from '@paserve/contracts';
import { Roles } from './roles.decorator.js';

export const SHOP_PERMISSIONS_KEY = 'paserve:shop-permissions';

/** Shared matrix -> exact role policy -> authentication and live membership guard. */
export function Permissions(...permissions: ShopPermission[]) {
  return applyDecorators(
    SetMetadata(SHOP_PERMISSIONS_KEY, Object.freeze([...permissions])),
    Roles(...rolesForShopPermissions(...permissions)),
  );
}
