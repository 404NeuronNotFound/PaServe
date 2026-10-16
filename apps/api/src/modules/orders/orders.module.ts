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
import { PreparationCompleteController } from './preparation-complete.controller.js';
import { PreparationCompleteService } from './preparation-complete.service.js';
import { CompletedSalesController } from './completed-sales.controller.js';
import { CompletedSalesService } from './completed-sales.service.js';
import { NewOrderEventsController } from './new-order-events.controller.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { CustomerOrderStatusService } from './customer-order-status.service.js';
import { setTrackingCookie } from './guest-tracking-cookie.js';
import {
  ConfirmedOrderEventsController,
  CustomerOrderStatusController,
} from './confirmed-order-events.controller.js';

@Controller('menu/:shopSlug/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  async create(
    @Param('shopSlug') slug: string,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const { trackingToken, order } = await this.orders.create(slug, dto);
    if (order.qrTokenExpiresAt)
      setTrackingCookie(
        res,
        slug,
        order.id,
        trackingToken,
        new Date(order.qrTokenExpiresAt),
      );
    return { order };
  }
}
@Module({
  imports: [ShopMembersModule, RealtimeModule],
  controllers: [
    OrdersController,
    NewOrderEventsController,
    ConfirmedOrderEventsController,
    CustomerOrderStatusController,
    OrderQrController,
    OrderDecisionController,
    CashPaymentController,
    PreparationQueueController,
    PreparationStartController,
    PreparationReadyController,
    PreparationCompleteController,
    CompletedSalesController,
  ],
  providers: [
    OrdersService,
    CustomerOrderStatusService,
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
    PreparationCompleteService,
    CompletedSalesService,
  ],
})
export class OrdersModule {}
