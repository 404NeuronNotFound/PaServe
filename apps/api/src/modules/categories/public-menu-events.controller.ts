import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../database/prisma.service.js';
import { NewOrderEventsService } from '../orders/new-order-events.service.js';

@Controller('menu/:shopSlug')
export class PublicMenuEventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: NewOrderEventsService,
  ) {}

  @Get('availability-events')
  async stream(@Param('shopSlug') slug: string, @Res() response: Response) {
    const unavailable = () =>
      new NotFoundException({
        code: 'MENU_NOT_FOUND',
        message: 'This menu is unavailable.',
      });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
      throw unavailable();
    const shop = await this.prisma.shop.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!shop) throw unavailable();
    return this.events.relay(
      `menu:availability:${shop.id}:${slug}`,
      'product_sold_out',
      { shopSlug: slug },
      async () => {
        if (
          !(await this.prisma.shop.findFirst({
            where: { id: shop.id, slug, isActive: true },
            select: { id: true },
          }))
        )
          throw unavailable();
      },
      response,
    );
  }
}
