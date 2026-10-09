import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class ShopsRepository {
  constructor(private readonly prisma: PrismaService) {}

  updateSettings(
    userId: string,
    shopId: string,
    data: { name?: string; description?: string | null },
  ) {
    return this.prisma.shop.update({
      // Check ownership in the write too, in case it changed after the guard.
      where: {
        id: shopId,
        isActive: true,
        members: { some: { userId, role: 'OWNER', user: { isActive: true } } },
      },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

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
        // Ownership is assigned by the server on this shop's membership only.
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
