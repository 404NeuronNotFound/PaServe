import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { CancelledOrdersService } from './cancelled-orders.service.js';
import { ownerOrderFiltersFromQuery } from './owner-order-filters.js';

@Controller('shops/:shopId/orders')
export class CancelledOrdersController {
  constructor(private readonly orders: CancelledOrdersService) {}
  @Get('cancelled')
  @Permissions('shop.orders.overview.read')
  list(
    @Query('cursor') cursor: unknown,
    @Query('search') search: unknown,
    @Query() query: Record<string, unknown>,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.orders.list(
      request.user.id,
      request.shopMembership.shopId,
      cursor,
      search,
      ownerOrderFiltersFromQuery(query),
      { page: query.page, snapshot: query.snapshot },
    );
  }
}
