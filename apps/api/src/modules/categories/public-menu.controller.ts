import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Res,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import { publicTablePath, type PublicMenuResponse } from '@paserve/contracts';
import { PublicMenuRepository } from './public-menu.repository.js';
import { menuPages, type MenuPageQuery } from './public-menu.repository.js';
import { PublicTablesRepository } from '../tables/public-tables.repository.js';
import { TableContextService } from '../tables/table-context.service.js';

@Controller('menu')
@RateLimit('publicRead')
export class PublicMenuController {
  constructor(
    private readonly menus: PublicMenuRepository,
    private readonly tables: PublicTablesRepository,
    private readonly contexts: TableContextService,
  ) {}
  @RateLimit('tableContext')
  @Get(':shopSlug/table/:tableCode')
  async readTable(
    @Param('shopSlug') slug: string,
    @Param('tableCode') code: string,
    @Res({ passthrough: true }) res: Response,
    @Query() query: MenuPageQuery = {},
  ): Promise<PublicMenuResponse> {
    res.setHeader('Cache-Control', 'no-store');
    try {
      publicTablePath(slug, code);
    } catch {
      throw this.tableUnavailable();
    }
    const table = await this.tables.resolve(slug, code);
    if (!table) throw this.tableUnavailable();
    // Recheck active table and shop in the menu query after resolving the code.
    return {
      ...(await this.load(slug, code, query)),
      table: { ...table, checkoutToken: this.contexts.issue(slug, code) },
    };
  }
  private tableUnavailable() {
    return new NotFoundException({
      code: 'TABLE_NOT_FOUND',
      message: 'This table menu is unavailable.',
    });
  }
  @Get(':shopSlug')
  async read(
    @Param('shopSlug') slug: string,
    @Res({ passthrough: true }) res: Response,
    @Query() query: MenuPageQuery = {},
  ): Promise<PublicMenuResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.load(slug, undefined, query);
  }
  private async load(
    slug: string,
    tableCode?: string,
    query: MenuPageQuery = {},
  ): Promise<PublicMenuResponse> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
      throw new NotFoundException({
        code: 'MENU_NOT_FOUND',
        message: 'This menu is unavailable.',
      });
    const pages = menuPages(slug, tableCode, query);
    const result = await this.menus.read(slug, tableCode, query);
    if (!result)
      throw new NotFoundException({
        code: 'MENU_NOT_FOUND',
        message: 'This menu is unavailable.',
      });
    const { categories, products, ...shop } = result;
    const productPage = pages.products.finish(products);
    const categoryPage = pages.categories.finish(categories);
    const menuProducts = productPage.items.map((product) => ({
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price.toFixed(2),
      imageUrl: product.imageUrl,
      isOrderable: product.status === 'AVAILABLE',
      status: product.status as 'AVAILABLE' | 'SOLD_OUT',
      isFeatured: product.isFeatured,
      featuredSortOrder: product.featuredSortOrder,
      sortOrder: product.sortOrder,
    }));
    return {
      shop,
      categories: categoryPage.items.map(
        ({ createdAt: _createdAt, ...category }) => category,
      ),
      nextProductsCursor: productPage.nextCursor,
      nextCategoriesCursor: categoryPage.nextCursor,
      products: menuProducts,
      featuredProducts: menuProducts
        .filter((product) => product.isFeatured)
        .sort(
          (a, b) =>
            (a.featuredSortOrder ?? a.sortOrder) -
              (b.featuredSortOrder ?? b.sortOrder) || a.id.localeCompare(b.id),
        ),
    };
  }
}
