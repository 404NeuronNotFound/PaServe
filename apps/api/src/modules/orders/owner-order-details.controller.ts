import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { OwnerOrderDetailsService } from './owner-order-details.service.js';

@Controller('shops/:shopId/orders')
export class OwnerOrderDetailsController {
  constructor(private readonly orders: OwnerOrderDetailsService) {}

  @Get(':orderId/details')
  @Roles('OWNER')
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
