import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { OrderDecisionDto, RejectOrderDto } from './order-decision.dto.js';
import {
  OrderNumberDecisionDto,
  RejectOrderNumberDto,
} from './order-number-lookup.dto.js';
import { OrderDecisionService } from './order-decision.service.js';

@Controller('shops/:shopId/orders')
@RateLimit('orderAction')
export class OrderDecisionController {
  constructor(private readonly decisions: OrderDecisionService) {}
  @Post(':orderId/confirm-number')
  @HttpCode(200)
  @Permissions('shop.orders.confirm', 'shop.orders.read')
  confirmNumber(
    @Param('orderId') orderId: string,
    @Body() dto: OrderNumberDecisionDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.decisions.decide(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      'CONFIRMED',
      dto,
    );
  }
  @Post(':orderId/reject-number')
  @HttpCode(200)
  @Permissions('shop.orders.reject', 'shop.orders.read')
  rejectNumber(
    @Param('orderId') orderId: string,
    @Body() dto: RejectOrderNumberDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.decisions.decide(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      'REJECTED',
      dto,
    );
  }
  @RateLimit('staffVerification')
  @Post(':orderId/confirm')
  @HttpCode(200)
  @Permissions('shop.orders.confirm', 'shop.orders.read')
  confirm(
    @Param('orderId') orderId: string,
    @Body() dto: OrderDecisionDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.decisions.decide(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      'CONFIRMED',
      dto,
    );
  }
  @RateLimit('staffVerification')
  @Post(':orderId/reject')
  @HttpCode(200)
  @Permissions('shop.orders.reject', 'shop.orders.read')
  reject(
    @Param('orderId') orderId: string,
    @Body() dto: RejectOrderDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.decisions.decide(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      'REJECTED',
      dto,
    );
  }
}
