import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import {
  COMPLETED_SALES_ROLES,
  CompletedSalesService,
} from './completed-sales.service.js';

@Controller('shops/:shopId/reports')
export class CompletedSalesController {
  constructor(private readonly sales: CompletedSalesService) {}
  @Get('daily-sales')
  @Roles(...COMPLETED_SALES_ROLES)
  daily(
    @Query('date') date: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.daily(
      request.user.id,
      request.shopMembership.shopId,
      date,
    );
  }
  @Get('completed-sales')
  @Roles(...COMPLETED_SALES_ROLES)
  summary(
    @Query('from') from: unknown,
    @Query('to') to: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.summary(
      request.user.id,
      request.shopMembership.shopId,
      from,
      to,
    );
  }
}
