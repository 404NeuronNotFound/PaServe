import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { UserMembership } from '@paserve/contracts';
import { ShopMembersRepository } from './shop-members.repository.js';

@Injectable()
export class ShopMembersService {
  constructor(private readonly repository: ShopMembersRepository) {}

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
    if (!membership || !membership.user.isActive || !membership.shop.isActive) {
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
      },
    };
  }
}
