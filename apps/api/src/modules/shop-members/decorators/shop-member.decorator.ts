import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { ShopMembershipGuard } from '../guards/shop-membership.guard.js';

/** Authenticate, then validate live membership for the route's :shopId. */
export function ShopMember() {
  return UseGuards(JwtAuthGuard, ShopMembershipGuard);
}
