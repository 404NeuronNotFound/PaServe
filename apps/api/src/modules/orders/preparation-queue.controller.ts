import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import {
  PreparationQueueService,
  PREPARATION_QUEUE_ROLES,
} from './preparation-queue.service.js';

@Controller('shops/:shopId/preparation/queue')
export class PreparationQueueController {
  constructor(private readonly queue: PreparationQueueService) {}

  @Get()
  @Roles(...PREPARATION_QUEUE_ROLES)
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
}
