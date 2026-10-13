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
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import {
  CashPaymentService,
  CASH_PAYMENT_ROLES,
} from './cash-payment.service.js';
import { CashPaymentDto } from './cash-payment.dto.js';
import { LookupOrderNumberDto } from './order-number-lookup.dto.js';

@Controller('shops/:shopId/orders')
export class CashPaymentController {
  constructor(private readonly cash: CashPaymentService) {}
  @Post('cash-payment/lookup-number')
  @HttpCode(200)
  @Roles(...CASH_PAYMENT_ROLES)
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
  @Roles(...CASH_PAYMENT_ROLES)
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
  @Roles(...CASH_PAYMENT_ROLES)
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
