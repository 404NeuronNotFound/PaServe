import { Module } from '@nestjs/common';
import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicProductRepository } from '../products/public-product.repository.js';
import { PublicProductService } from '../products/public-product.service.js';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './create-order.dto.js';
import { TableContextService } from '../tables/table-context.service.js';
import { OrderTokenService } from './order-token.service.js';
import { ShopMembersModule } from '../shop-members/shop-members.module.js';
import { OrderQrController } from './order-qr.controller.js';
import { OrderQrService } from './order-qr.service.js';

@Controller('menu/:shopSlug/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  create(
    @Param('shopSlug') slug: string,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.orders.create(slug, dto);
  }
}
@Module({
  imports: [ShopMembersModule],
  controllers: [OrdersController, OrderQrController],
  providers: [
    OrdersService,
    PublicProductService,
    PublicProductRepository,
    TableContextService,
    OrderTokenService,
    OrderQrService,
  ],
})
export class OrdersModule {}
