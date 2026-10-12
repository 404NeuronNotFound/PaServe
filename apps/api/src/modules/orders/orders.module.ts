import { Module } from '@nestjs/common';
import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicProductRepository } from '../products/public-product.repository.js';
import { PublicProductService } from '../products/public-product.service.js';
import { OrdersService } from './orders.service.js';
import { CreateDineInOrderDto } from './create-dine-in-order.dto.js';
import { TableContextService } from '../tables/table-context.service.js';

@Controller('menu/:shopSlug/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  create(
    @Param('shopSlug') slug: string,
    @Body() dto: CreateDineInOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.orders.create(slug, dto);
  }
}
@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    PublicProductService,
    PublicProductRepository,
    TableContextService,
  ],
})
export class OrdersModule {}
