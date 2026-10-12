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
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ORDER_QR_ROLES, OrderQrService } from './order-qr.service.js';
import { VerifyOrderQrDto } from './verify-order-qr.dto.js';

@Controller('shops/:shopId/orders')
export class OrderQrController {
  constructor(private readonly qr: OrderQrService) {}

  @Post(':orderId/verify-qr')
  @HttpCode(200)
  @Roles(...ORDER_QR_ROLES)
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
