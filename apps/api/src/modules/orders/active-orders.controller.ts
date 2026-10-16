import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ActiveOrdersService } from './active-orders.service.js';

@Controller('shops/:shopId/orders')
export class ActiveOrdersController {
  constructor(private readonly orders: ActiveOrdersService) {}

  @Get('active')
  @Roles('OWNER')
  list(
    @Query('cursor') cursor: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.orders.list(
      request.user.id,
      request.shopMembership.shopId,
      cursor,
    );
  }
}
