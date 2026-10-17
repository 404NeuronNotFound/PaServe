import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  hasShopPermission,
  canTransitionPreparationStatus,
  isShopOwner,
  type PreparationStatus,
  type ShopPermission,
  type UserMembership,
} from '@paserve/contracts';
import { ShopMembersRepository } from './shop-members.repository.js';

@Injectable()
export class ShopMembersService {
  constructor(private readonly repository: ShopMembersRepository) {}

  /** Future callers must obtain `from` from the tenant-scoped stored record. */
  async requirePreparationTransition(
    userId: string,
    shopId: string,
    from: PreparationStatus,
    to: PreparationStatus,
  ): Promise<UserMembership> {
    const membership = await this.requirePermission(
      userId,
      shopId,
      'shop.preparation.status.update',
    );
    if (!canTransitionPreparationStatus(from, to))
      throw new BadRequestException({
        code: 'INVALID_PREPARATION_TRANSITION',
        message: 'This preparation status change is not allowed.',
      });
    return membership;
  }

  /** Resolve current membership before evaluating a shop-scoped permission. */
  async requirePermission(
    userId: string,
    shopId: string,
    permission: ShopPermission,
  ): Promise<UserMembership> {
    const membership = await this.requireMembership(userId, shopId);
    if (!hasShopPermission(membership.role, permission))
      throw new ForbiddenException({
        code: 'SHOP_PERMISSION_REQUIRED',
        message: 'Your role does not allow this action in this shop.',
      });
    return membership;
  }

  async requireOwner(userId: string, shopId: string): Promise<UserMembership> {
    const membership = await this.requireMembership(userId, shopId);
    if (!isShopOwner(membership.role))
      throw new ForbiddenException({
        code: 'OWNER_REQUIRED',
        message: 'Only this shop’s owner can perform this action.',
      });
    return membership;
  }

  async requireMembership(
    userId: string,
    shopId: string,
  ): Promise<UserMembership> {
    if (!isUUID(shopId))
      throw new BadRequestException({
        code: 'INVALID_SHOP_ID',
        message: 'Enter a valid shop identifier.',
      });
    const membership = await this.repository.findMembership(userId, shopId);
    if (
      !membership ||
      membership.disabledAt ||
      !membership.user.isActive ||
      !membership.shop.isActive
    ) {
      // The same response prevents nonmembers from discovering other shops.
      throw new NotFoundException({
        code: 'SHOP_NOT_ACCESSIBLE',
        message: 'This shop is unavailable or you do not have access.',
      });
    }
    return {
      id: membership.id,
      shopId: membership.shopId,
      role: membership.role,
      shop: {
        id: membership.shop.id,
        name: membership.shop.name,
        slug: membership.shop.slug,
        isActive: membership.shop.isActive,
        logoUrl: membership.shop.logoUrl,
      },
    };
  }
}
