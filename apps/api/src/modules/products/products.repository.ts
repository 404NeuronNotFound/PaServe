import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import type { ProductStatus } from '@paserve/contracts';

const roles = ['OWNER', 'ADMIN', 'MANAGER'] as const;
const productSelect = {
  id: true,
  shopId: true,
  categoryId: true,
  name: true,
  slug: true,
  description: true,
  price: true,
  imageUrl: true,
  status: true,
  isFeatured: true,
  isArchived: true,
  sortOrder: true,
  createdAt: true,
} as const;
export type ProductCreateData = {
  name: string;
  slug: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  status: ProductStatus;
  isFeatured: boolean;
  sortOrder: number;
};

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}
  setArchived(
    userId: string,
    shopId: string,
    productId: string,
    isArchived: boolean,
    expectedArchived: boolean,
  ) {
    return this.prisma.product.update({
      where: {
        id: productId,
        shopId,
        isArchived: expectedArchived,
        shop: shopAccessWhere(userId, shopId, roles),
      },
      data: { isArchived },
      select: productSelect,
    });
  }
  update(
    userId: string,
    shopId: string,
    productId: string,
    categoryId: string | null | undefined,
    data: Partial<Omit<ProductCreateData, 'slug'>>,
  ) {
    return this.prisma.product.update({
      where: {
        id: productId,
        shopId,
        isArchived: false,
        shop: shopAccessWhere(userId, shopId, roles),
      },
      data: {
        ...data,
        ...(categoryId === undefined
          ? {}
          : categoryId === null
            ? { category: { disconnect: true } }
            : {
                category: {
                  connect: {
                    id: categoryId,
                    shopId,
                    shop: shopAccessWhere(userId, shopId, roles),
                  },
                },
              }),
      },
      select: productSelect,
    });
  }
  create(
    userId: string,
    shopId: string,
    categoryId: string | undefined,
    data: ProductCreateData,
  ) {
    const select = {
      products: { where: { shopId, slug: data.slug }, select: productSelect },
    };
    // Conditional parent writes make product creation and category/shop ownership checks atomic.
    if (categoryId)
      return this.prisma.category.update({
        where: {
          id: categoryId,
          shopId,
          shop: shopAccessWhere(userId, shopId, roles),
        },
        data: {
          products: { create: { ...data, shop: { connect: { id: shopId } } } },
        },
        select,
      });
    return this.prisma.shop.update({
      where: shopAccessWhere(userId, shopId, roles),
      data: { products: { create: data } },
      select,
    });
  }
  list(userId: string, shopId: string) {
    return this.prisma.shop.findFirst({
      where: shopAccessWhere(userId, shopId, roles),
      select: {
        products: {
          where: { shopId },
          select: productSelect,
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
  }
}
