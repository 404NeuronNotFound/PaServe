import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';

const roles = ['OWNER', 'ADMIN', 'MANAGER'] as const;
const categorySelect = {
  id: true,
  shopId: true,
  name: true,
  description: true,
  slug: true,
  sortOrder: true,
  isVisible: true,
  createdAt: true,
} as const;

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}
  update(
    userId: string,
    shopId: string,
    id: string,
    data: { name?: string; description?: string | null },
  ) {
    return this.prisma.category.update({
      where: { id, shopId, shop: shopAccessWhere(userId, shopId, roles) },
      data,
      select: categorySelect,
    });
  }
  list(userId: string, shopId: string) {
    // Parent scope repeats live authorization and distinguishes lost access from an empty menu.
    return this.prisma.shop.findFirst({
      where: shopAccessWhere(userId, shopId, roles),
      select: {
        categories: {
          where: { shopId },
          select: categorySelect,
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
  }
  create(userId: string, shopId: string, name: string, slug: string) {
    // The conditional parent write and child creation run atomically; no client tenant assignment.
    return this.prisma.shop.update({
      where: shopAccessWhere(userId, shopId, roles),
      data: { categories: { create: { name, slug } } },
      select: {
        categories: { where: { shopId, slug }, select: categorySelect },
      },
    });
  }
}
