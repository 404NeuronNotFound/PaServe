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
import { OrderQrService } from './order-qr.service.js';
import { VerifyOrderQrDto } from './verify-order-qr.dto.js';
import { LookupOrderNumberDto } from './order-number-lookup.dto.js';

@Controller('shops/:shopId/orders')
@RateLimit('staffVerification')
export class OrderQrController {
  constructor(private readonly qr: OrderQrService) {}
  @Post('lookup-number')
  @HttpCode(200)
  @Permissions('shop.orders.qr.scan', 'shop.orders.read')
  lookup(
    @Body() dto: LookupOrderNumberDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.qr.lookupNumber(
      request.user.id,
      request.shopMembership.shopId,
      dto.orderNumber,
    );
  }

  @Post('scan-qr')
  @HttpCode(200)
  @Permissions('shop.orders.qr.scan', 'shop.orders.read')
  scan(
    @Body() dto: VerifyOrderQrDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.qr.scan(
      request.user.id,
      request.shopMembership.shopId,
      dto.qrToken,
    );
  }

  @Post(':orderId/verify-qr')
  @HttpCode(200)
  @Permissions('shop.orders.qr.scan', 'shop.orders.read')
  verify(
    @Param('orderId') orderId: string,
    @Body() dto: VerifyOrderQrDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.qr.verify(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
      dto.qrToken,
    );
  }
}
