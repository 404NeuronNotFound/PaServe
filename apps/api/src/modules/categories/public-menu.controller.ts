import { Controller, Get, Param, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { PublicMenuResponse } from '@paserve/contracts';
import { PublicMenuRepository } from './public-menu.repository.js';

@Controller('menu')
export class PublicMenuController {
  constructor(private readonly menus: PublicMenuRepository) {}
  @Get(':shopSlug')
  async read(
    @Param('shopSlug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicMenuResponse> {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
      throw new NotFoundException({
        code: 'MENU_NOT_FOUND',
        message: 'This menu is unavailable.',
      });
    const result = await this.menus.read(slug);
    if (!result)
      throw new NotFoundException({
        code: 'MENU_NOT_FOUND',
        message: 'This menu is unavailable.',
      });
    const { categories, products, ...shop } = result;
    return {
      shop,
      categories,
      products: products.map((product) => ({
        ...product,
        price: product.price.toFixed(2),
        isOrderable: product.status === 'AVAILABLE',
        status: product.status as 'AVAILABLE' | 'SOLD_OUT',
      })),
    };
  }
}
