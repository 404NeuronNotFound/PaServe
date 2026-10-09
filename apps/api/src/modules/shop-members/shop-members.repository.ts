import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class ShopMembersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMembership(userId: string, shopId: string) {
    return this.prisma.shopMember.findUnique({
      where: { userId_shopId: { userId, shopId } },
      select: {
        id: true,
        shopId: true,
        role: true,
        user: { select: { isActive: true } },
        shop: { select: { id: true, name: true, slug: true, isActive: true } },
      },
    });
  }
}
