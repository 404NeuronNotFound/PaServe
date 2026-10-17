import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { CashPaymentService } from './cash-payment.service.js';
import { CashPaymentDto } from './cash-payment.dto.js';
import { ManualGcashPaymentDto } from './manual-gcash-payment.dto.js';
import { ManualCardPaymentDto } from './manual-card-payment.dto.js';
import { OtherPaymentDto } from './other-payment.dto.js';
import { CreatePaymentDto } from './create-payment.dto.js';
import { LookupOrderNumberDto } from './order-number-lookup.dto.js';

@Controller('shops/:shopId/orders')
export class CashPaymentController {
  constructor(private readonly cash: CashPaymentService) {}
  @Post(':orderId/create-payment')
  @HttpCode(200)
  @Permissions(
    'shop.payments.record',
    'shop.orders.read',
    'shop.orders.confirm',
  )
  create(
    @Param('orderId') orderId: string,
    @Body() dto: CreatePaymentDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.cash.create(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      dto,
    );
  }
  @Post(':orderId/other-payment')
  @HttpCode(200)
  @Permissions('shop.payments.record', 'shop.orders.read')
  recordOther(
    @Param('orderId') orderId: string,
    @Body() dto: OtherPaymentDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.cash.recordOther(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      dto,
    );
  }
  @Post(':orderId/card-manual-payment')
  @HttpCode(200)
  @Permissions('shop.payments.record', 'shop.orders.read')
  recordCard(
    @Param('orderId') orderId: string,
    @Body() dto: ManualCardPaymentDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.cash.recordCard(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      dto,
    );
  }
  @Post(':orderId/gcash-manual-payment')
  @HttpCode(200)
  @Permissions('shop.payments.record', 'shop.orders.read')
  recordGcash(
    @Param('orderId') orderId: string,
    @Body() dto: ManualGcashPaymentDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.cash.recordGcash(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      dto,
    );
  }
  @Post('cash-payment/lookup-number')
  @HttpCode(200)
  @Permissions('shop.payments.record', 'shop.orders.read')
  lookup(
    @Body() dto: LookupOrderNumberDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.cash.lookup(
      request.user.id,
      request.shopMembership.shopId,
      dto.orderNumber,
    );
  }
  @Get(':orderId/cash-payment')
  @Permissions('shop.payments.record', 'shop.orders.read')
  review(
    @Param('orderId') orderId: string,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.cash.review(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
    );
  }
  @Post(':orderId/cash-payment')
  @HttpCode(200)
  @Permissions('shop.payments.record', 'shop.orders.read')
  collect(
    @Param('orderId') orderId: string,
    @Body() dto: CashPaymentDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.cash.collect(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      dto,
    );
  }
}
