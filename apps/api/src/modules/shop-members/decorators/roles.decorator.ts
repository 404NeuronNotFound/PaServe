import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { ShopRole } from '@paserve/contracts';
import { RolesGuard } from '../guards/roles.guard.js';
import { SHOP_ROLES_KEY } from '../roles.metadata.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

export { SHOP_ROLES_KEY } from '../roles.metadata.js';

/** Installs authentication followed by live shop-role enforcement. */
export function Roles(...roles: ShopRole[]) {
  return applyDecorators(
    SetMetadata(SHOP_ROLES_KEY, Object.freeze([...roles])),
    UseGuards(JwtAuthGuard, RolesGuard),
  );
}
