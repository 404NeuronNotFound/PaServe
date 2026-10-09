import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SHOP_ROLES, type ShopRole } from '@paserve/contracts';
import { invalidSession } from '../../auth/tokens.service.js';
import { ShopMembersService } from '../shop-members.service.js';
import type { ShopMemberRequest } from './shop-membership.guard.js';
import { SHOP_ROLES_KEY } from '../roles.metadata.js';

/** Always resolves live membership for :shopId; never trusts cached role claims. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: ShopMembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ShopMemberRequest>();
    if (!request.user?.id) throw invalidSession();
    const roles = this.reflector.getAllAndOverride<readonly ShopRole[]>(
      SHOP_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      !Array.isArray(roles) ||
      !roles.length ||
      !Array.from(roles).every((role) => SHOP_ROLES.includes(role))
    )
      throw new ForbiddenException({
        code: 'SHOP_ROLE_POLICY_REQUIRED',
        message: 'This action has no valid shop-role policy.',
      });
    const shopId = request.params.shopId;
    const membership = await this.memberships.requireMembership(
      request.user.id,
      typeof shopId === 'string' ? shopId : '',
    );
    if (!roles.includes(membership.role)) {
      const ownerOnly = roles.length === 1 && roles[0] === 'OWNER';
      throw new ForbiddenException({
        code: ownerOnly ? 'OWNER_REQUIRED' : 'SHOP_ROLE_REQUIRED',
        message: ownerOnly
          ? 'Only this shop’s owner can perform this action.'
          : 'Your role does not allow this action in this shop.',
      });
    }
    request.shopMembership = membership;
    return true;
  }
}
