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
  @Get('average-prep-time')
  @Roles(...COMPLETED_SALES_ROLES)
  averagePrepTime(
    @Query('startDate') startDate: unknown,
    @Query('endDate') endDate: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.averagePrepTime(
      request.user.id,
      request.shopMembership.shopId,
      startDate,
      endDate,
    );
  }
  @Get('peak-hours')
  @Roles(...COMPLETED_SALES_ROLES)
  peakHours(
    @Query('startDate') startDate: unknown,
    @Query('endDate') endDate: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.peakHours(
      request.user.id,
      request.shopMembership.shopId,
      startDate,
      endDate,
    );
  }
  @Get('top-products')
  @Roles(...COMPLETED_SALES_ROLES)
  topProducts(
    @Query('startDate') startDate: unknown,
    @Query('endDate') endDate: unknown,
    @Query('metric') metric: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.topProducts(
      request.user.id,
      request.shopMembership.shopId,
      startDate,
      endDate,
      metric,
    );
  }
  @Get('custom-sales')
  @Roles(...COMPLETED_SALES_ROLES)
  custom(
    @Query('startDate') startDate: unknown,
    @Query('endDate') endDate: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.custom(
      request.user.id,
      request.shopMembership.shopId,
      startDate,
      endDate,
    );
  }
  @Get('monthly-analytics')
  @Roles(...COMPLETED_SALES_ROLES)
  monthlyAnalytics(
    @Query('startDate') startDate: unknown,
    @Query('endDate') endDate: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.monthlyAnalytics(
      request.user.id,
      request.shopMembership.shopId,
      startDate,
      endDate,
    );
  }
  @Get('weekly-analytics')
  @Roles(...COMPLETED_SALES_ROLES)
  weeklyAnalytics(
    @Query('startDate') startDate: unknown,
    @Query('endDate') endDate: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.weeklyAnalytics(
      request.user.id,
      request.shopMembership.shopId,
      startDate,
      endDate,
    );
  }
  @Get('daily-analytics')
  @Roles(...COMPLETED_SALES_ROLES)
  dailyAnalytics(
    @Query('startDate') startDate: unknown,
    @Query('endDate') endDate: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.dailyAnalytics(
      request.user.id,
      request.shopMembership.shopId,
      startDate,
      endDate,
    );
  }
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
