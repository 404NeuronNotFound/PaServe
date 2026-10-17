import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { PreparationQueueService } from './preparation-queue.service.js';

@Controller('shops/:shopId/preparation')
export class PreparationQueueController {
  constructor(private readonly queue: PreparationQueueService) {}
  @Get('completed')
  @Permissions('shop.preparation.queue.read')
  completed(
    @Query('search') search: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.queue.list(
      request.user.id,
      request.shopMembership.shopId,
      cursor,
      'COMPLETED',
      { search, from, to, limit },
    );
  }
  @Get('ready')
  @Permissions('shop.preparation.queue.read')
  ready(
    @Query('cursor') cursor: string | undefined,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.queue.list(
      request.user.id,
      request.shopMembership.shopId,
      cursor,
      'READY',
    );
  }

  @Get('queue')
  @Permissions('shop.preparation.queue.read')
  list(
    @Query('cursor') cursor: string | undefined,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.queue.list(
      request.user.id,
      request.shopMembership.shopId,
      cursor,
    );
  }
  @Get('preparing')
  @Permissions('shop.preparation.queue.read')
  preparing(
    @Query('cursor') cursor: string | undefined,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.queue.list(
      request.user.id,
      request.shopMembership.shopId,
      cursor,
      'PREPARING',
    );
  }
}
