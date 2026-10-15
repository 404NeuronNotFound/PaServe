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
import { OrderDecisionService } from './order-decision.service.js';
import { OrderDecisionController } from './order-decision.controller.js';
import { CashPaymentController } from './cash-payment.controller.js';
import { CashPaymentService } from './cash-payment.service.js';
import { PreparationQueueService } from './preparation-queue.service.js';
import { PreparationQueueController } from './preparation-queue.controller.js';
import { PreparationStartController } from './preparation-start.controller.js';
import { PreparationStartService } from './preparation-start.service.js';
import { PreparationReadyController } from './preparation-ready.controller.js';
import { PreparationReadyService } from './preparation-ready.service.js';

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
  controllers: [
    OrdersController,
    OrderQrController,
    OrderDecisionController,
    CashPaymentController,
    PreparationQueueController,
    PreparationStartController,
    PreparationReadyController,
  ],
  providers: [
    OrdersService,
    PublicProductService,
    PublicProductRepository,
    TableContextService,
    OrderTokenService,
    OrderQrService,
    OrderDecisionService,
    CashPaymentService,
    PreparationQueueService,
    PreparationStartService,
    PreparationReadyService,
  ],
})
export class OrdersModule {}
