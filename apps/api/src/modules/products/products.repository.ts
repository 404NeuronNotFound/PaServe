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
import { productPage, type ProductPageQuery } from './product-page.js';
import type { ProductStatus } from '@paserve/contracts';

const roles = rolesForShopPermissions('shop.menu.manage');
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
  featuredSortOrder: true,
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
  reorder(
    userId: string,
    shopId: string,
    categoryId: string | null,
    productIds: string[],
    expectedOrder: string[],
    featured = false,
  ) {
    const scope = featured
      ? { shopId, isFeatured: true, isArchived: false }
      : { shopId, categoryId, isArchived: false };
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [
      featured ? { featuredSortOrder: 'asc' } : { sortOrder: 'asc' },
      ...(featured
        ? [{ id: 'asc' as const }]
        : [{ createdAt: 'asc' as const }, { id: 'asc' as const }]),
    ];
    return this.prisma.$transaction(
      async (tx) => {
        if (
          !featured &&
          categoryId &&
          !(await tx.category.findFirst({
            where: {
              id: categoryId,
              shopId,
              shop: shopAccessWhere(userId, shopId, roles),
            },
            select: { id: true },
          }))
        )
          throw new NotFoundException({
            code: 'RESOURCE_NOT_ACCESSIBLE',
            message: 'This category is unavailable in this shop.',
          });
        const shop = await tx.shop.findFirst({
          where: shopAccessWhere(userId, shopId, roles),
          select: {
            products: {
              where: scope,
              take: 501,
              select: { id: true },
              orderBy,
            },
          },
        });
        if (!shop)
          throw new ForbiddenException({
            code: 'SHOP_PERMISSION_REQUIRED',
            message: 'Your menu management access is no longer available.',
          });
        const current = shop.products.map((product) => product.id);
        const currentIds = new Set(current);
        if (productIds.some((id) => !currentIds.has(id)))
          throw new NotFoundException({
            code: 'RESOURCE_NOT_ACCESSIBLE',
            message: 'One or more products are unavailable in this shop.',
          });
        if (
          current.length !== expectedOrder.length ||
          current.some((id, index) => id !== expectedOrder[index])
        )
          throw new ConflictException({
            code: 'PRODUCT_ORDER_CHANGED',
            message:
              'The product list or order changed. Refresh before saving again.',
          });
        for (const [sortOrder, id] of productIds.entries()) {
          await tx.product.update({
            where: {
              id,
              ...scope,
              shop: shopAccessWhere(userId, shopId, roles),
            },
            data: featured ? { featuredSortOrder: sortOrder } : { sortOrder },
            select: { id: true },
          });
        }
        const result = await tx.shop.findFirst({
          where: shopAccessWhere(userId, shopId, roles),
          select: {
            products: {
              where: scope,
              take: 500,
              select: productSelect,
              orderBy,
            },
          },
        });
        if (!result)
          throw new ForbiddenException({
            code: 'SHOP_PERMISSION_REQUIRED',
            message: 'Your menu management access is no longer available.',
          });
        return result.products;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
  }
  setFeatured(
    userId: string,
    shopId: string,
    productId: string,
    isFeatured: boolean,
    expectedFeatured: boolean,
  ) {
    return this.prisma.product.update({
      where: {
        id: productId,
        shopId,
        isArchived: false,
        isFeatured: expectedFeatured,
        shop: shopAccessWhere(userId, shopId, roles),
      },
      data: { isFeatured },
      select: productSelect,
    });
  }
  setAvailable(
    userId: string,
    shopId: string,
    productId: string,
    expectedStatus: ProductStatus,
  ) {
    return this.setAvailability(
      userId,
      shopId,
      productId,
      expectedStatus,
      'AVAILABLE',
    );
  }
  setSoldOut(
    userId: string,
    shopId: string,
    productId: string,
    expectedStatus: ProductStatus,
  ) {
    return this.setAvailability(
      userId,
      shopId,
      productId,
      expectedStatus,
      'SOLD_OUT',
    );
  }
  setHidden(
    userId: string,
    shopId: string,
    productId: string,
    expectedStatus: ProductStatus,
  ) {
    return this.setAvailability(
      userId,
      shopId,
      productId,
      expectedStatus,
      'HIDDEN',
    );
  }
  private setAvailability(
    userId: string,
    shopId: string,
    productId: string,
    expectedStatus: ProductStatus,
    status: 'AVAILABLE' | 'SOLD_OUT' | 'HIDDEN',
  ) {
    return this.prisma.product.update({
      where: {
        id: productId,
        shopId,
        isArchived: false,
        status: expectedStatus,
        shop: shopAccessWhere(
          userId,
          shopId,
          expectedStatus === 'HIDDEN' || status === 'HIDDEN'
            ? roles
            : rolesForShopPermissions('shop.menu.availability.update'),
        ),
      },
      data: { status },
      select: productSelect,
    });
  }
  findForImage(userId: string, shopId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        shopId,
        isArchived: false,
        shop: shopAccessWhere(userId, shopId, roles),
      },
      select: { id: true },
    });
  }
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
  async list(userId: string, shopId: string, query: ProductPageQuery = {}) {
    const page = productPage(query, shopId);
    const access = shopAccessWhere(userId, shopId, roles);
    if (
      !(await this.prisma.shop.findFirst({
        where: access,
        select: { id: true },
      }))
    )
      return null;
    return {
      products: await this.prisma.product.findMany({
        where: { shopId, shop: access, ...page.where },
        take: page.take,
        select: productSelect,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    };
  }
}
