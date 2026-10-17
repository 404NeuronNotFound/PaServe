import { rolesForShopPermissions } from '@paserve/contracts';
import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';

const roles = rolesForShopPermissions('shop.menu.manage');
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
  reorder(
    userId: string,
    shopId: string,
    categoryIds: string[],
    expectedOrder: string[],
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const shop = await tx.shop.findFirst({
          where: shopAccessWhere(userId, shopId, roles),
          select: {
            categories: {
              where: { shopId },
              select: { id: true },
              orderBy: [
                { sortOrder: 'asc' },
                { createdAt: 'asc' },
                { id: 'asc' },
              ],
            },
          },
        });
        if (!shop)
          throw new ForbiddenException({
            code: 'SHOP_PERMISSION_REQUIRED',
            message: 'Your menu management access is no longer available.',
          });
        const current = shop.categories.map((category) => category.id);
        const currentIds = new Set(current);
        if (categoryIds.some((id) => !currentIds.has(id)))
          throw new NotFoundException({
            code: 'RESOURCE_NOT_ACCESSIBLE',
            message: 'One or more categories are unavailable in this shop.',
          });
        if (
          current.length !== expectedOrder.length ||
          current.some((id, index) => id !== expectedOrder[index])
        )
          throw new ConflictException({
            code: 'CATEGORY_ORDER_CHANGED',
            message:
              'The category list or order changed. Refresh before saving again.',
          });
        for (const [sortOrder, id] of categoryIds.entries()) {
          await tx.category.update({
            where: { id, shopId, shop: shopAccessWhere(userId, shopId, roles) },
            data: { sortOrder },
            select: { id: true },
          });
        }
        const result = await tx.shop.findFirst({
          where: shopAccessWhere(userId, shopId, roles),
          select: {
            categories: {
              where: { shopId },
              select: categorySelect,
              orderBy: [
                { sortOrder: 'asc' },
                { createdAt: 'asc' },
                { id: 'asc' },
              ],
            },
          },
        });
        if (!result)
          throw new ForbiddenException({
            code: 'SHOP_PERMISSION_REQUIRED',
            message: 'Your menu management access is no longer available.',
          });
        return result.categories;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
  }
  setVisibility(
    userId: string,
    shopId: string,
    id: string,
    isVisible: boolean,
    expectedVisibility: boolean,
  ) {
    return this.prisma.category.update({
      where: {
        id,
        shopId,
        isVisible: expectedVisibility,
        shop: shopAccessWhere(userId, shopId, roles),
      },
      data: { isVisible },
      select: categorySelect,
    });
  }
  delete(userId: string, shopId: string, id: string) {
    // Both category FKs detach products atomically; the tenant FK clears only categoryId.
    return this.prisma.category.delete({
      where: { id, shopId, shop: shopAccessWhere(userId, shopId, roles) },
      select: { id: true },
    });
  }
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
