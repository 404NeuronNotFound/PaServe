import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { collectionPage } from '../../common/http/collection-page.js';

export type MenuPageQuery = {
  limit?: unknown;
  productsCursor?: unknown;
  categoriesCursor?: unknown;
};
export function menuPages(
  slug: string,
  tableCode: string | undefined,
  query: MenuPageQuery,
) {
  return {
    products: collectionPage(
      {
        limit: query.limit,
        cursor:
          query.productsCursor === 'end' ? undefined : query.productsCursor,
      },
      `public-products:${slug}:${tableCode ?? ''}`,
    ),
    categories: collectionPage(
      {
        limit: query.limit,
        cursor:
          query.categoriesCursor === 'end' ? undefined : query.categoriesCursor,
      },
      `public-categories:${slug}:${tableCode ?? ''}`,
    ),
  };
}

@Injectable()
export class PublicMenuRepository {
  constructor(private readonly prisma: PrismaService) {}
  async read(slug: string, tableCode?: string, query: MenuPageQuery = {}) {
    const pages = menuPages(slug, tableCode, query);
    // Public slugs resolve only active shops. All child queries repeat the resolved tenant.
    const shop = await this.prisma.shop.findFirst({
      where: {
        slug,
        isActive: true,
        ...(tableCode
          ? { tables: { some: { code: tableCode, isActive: true } } }
          : {}),
      },
      select: { id: true },
    });
    if (!shop) return null;
    const access = {
      id: shop.id,
      slug,
      isActive: true,
      ...(tableCode
        ? {
            tables: {
              some: { shopId: shop.id, code: tableCode, isActive: true },
            },
          }
        : {}),
    };
    const metadata = await this.prisma.shop.findFirst({
      where: access,
      select: {
        name: true,
        slug: true,
        description: true,
        logoUrl: true,
        bannerUrl: true,
        primaryColor: true,
        accentColor: true,
        menuLayout: true,
        dineInServiceMode: true,
      },
    });
    if (!metadata) return null;
    const orderBy = [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ] as const;
    const [categories, products] = await Promise.all([
      query.categoriesCursor === 'end'
        ? []
        : this.prisma.category.findMany({
            where: {
              shopId: shop.id,
              shop: access,
              isVisible: true,
              ...pages.categories.where,
            },
            take: pages.categories.take,
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              sortOrder: true,
              createdAt: true,
            },
            orderBy: [...orderBy],
          }),
      query.productsCursor === 'end'
        ? []
        : this.prisma.product.findMany({
            where: {
              shopId: shop.id,
              shop: access,
              isArchived: false,
              status: { in: ['AVAILABLE', 'SOLD_OUT'] },
              AND: [pages.products.where],
              OR: [
                { categoryId: null },
                { category: { shopId: shop.id, isVisible: true } },
              ],
            },
            take: pages.products.take,
            select: {
              id: true,
              createdAt: true,
              categoryId: true,
              name: true,
              slug: true,
              description: true,
              price: true,
              imageUrl: true,
              status: true,
              isFeatured: true,
              featuredSortOrder: true,
              sortOrder: true,
            },
            orderBy: [...orderBy],
          }),
    ]);
    return { ...metadata, categories, products };
  }
}
