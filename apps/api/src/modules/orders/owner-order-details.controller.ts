import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { OwnerOrderDetailsService } from './owner-order-details.service.js';

@Controller('shops/:shopId/orders')
export class OwnerOrderDetailsController {
  constructor(private readonly orders: OwnerOrderDetailsService) {}

  @Get(':orderId/details')
  @Permissions('shop.orders.overview.read')
  get(
    @Param('orderId') orderId: string,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.orders.get(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
    );
  }
}
