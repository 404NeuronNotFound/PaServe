import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { collectionPage } from '../../common/http/collection-page.js';
import { PublicMenuCache } from './public-menu-cache.js';

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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: PublicMenuCache,
  ) {}
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
    const loadRows = async () => {
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
      return { categories, products };
    };
    // Never cache table context/proofs or skip live shop visibility/metadata.
    // The version is read on every eligible request, so other API instances and
    // direct SQL catalog writes invalidate through the same committed state.
    if (!tableCode && this.cache?.enabled) {
      const state = await this.prisma.menuCacheState.findUnique({
        where: { shopId: shop.id },
        select: { version: true },
      });
      if (state) {
        const key = `${shop.id}:${state.version}:${createHash('sha256')
          .update(
            JSON.stringify([
              pages.products.limit,
              query.productsCursor ?? null,
              query.categoriesCursor ?? null,
            ]),
          )
          .digest('hex')}`;
        const json = await this.cache.getOrLoad(key, async () =>
          JSON.stringify(await loadRows()),
        );
        type Rows = Awaited<ReturnType<typeof loadRows>>;
        const rows = JSON.parse(json) as {
          categories: Array<
            Omit<Rows['categories'][number], 'createdAt'> & {
              createdAt: string;
            }
          >;
          products: Array<
            Omit<Rows['products'][number], 'createdAt' | 'price'> & {
              createdAt: string;
              price: string;
            }
          >;
        };
        return {
          ...metadata,
          categories: rows.categories.map((row) => ({
            ...row,
            createdAt: new Date(row.createdAt),
          })),
          products: rows.products.map((row) => ({
            ...row,
            createdAt: new Date(row.createdAt),
            price: new Prisma.Decimal(row.price),
          })),
        };
      }
    }
    return { ...metadata, ...(await loadRows()) };
  }
}
