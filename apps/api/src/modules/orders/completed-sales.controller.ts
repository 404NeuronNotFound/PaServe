import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { CompletedSalesService } from './completed-sales.service.js';

@Controller('shops/:shopId/reports')
@RateLimit('reports')
export class CompletedSalesController {
  constructor(private readonly sales: CompletedSalesService) {}
  @Get('sales-trends')
  @Permissions('shop.reports.read')
  salesTrends(
    @Query('startDate') startDate: unknown,
    @Query('endDate') endDate: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.sales.salesTrends(
      request.user.id,
      request.shopMembership.shopId,
      startDate,
      endDate,
    );
  }
  @Get('average-prep-time')
  @Permissions('shop.reports.read')
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
  @Permissions('shop.reports.read')
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
  @Permissions('shop.reports.read')
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
  @Permissions('shop.reports.read')
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
  @Permissions('shop.reports.read')
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
  @Permissions('shop.reports.read')
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
  @Permissions('shop.reports.read')
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
  @Permissions('shop.reports.read')
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
  @Permissions('shop.reports.read')
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
