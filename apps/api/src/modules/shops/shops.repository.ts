import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class ShopsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createWithOwner(
    userId: string,
    name: string,
    slug: string,
    description: string | null,
  ) {
    // Prisma nested writes are atomic: an owner failure rolls back the shop.
    return this.prisma.shop.create({
      data: {
        name,
        slug,
        description,
        members: { create: { userId, role: 'OWNER' } },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
        createdAt: true,
        members: { select: { id: true, shopId: true, role: true } },
      },
    });
  }
}
