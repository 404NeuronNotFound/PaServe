import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import { SHOP_ROLES } from '@paserve/contracts';
import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { NewOrderEventsService } from './new-order-events.service.js';
import type { OrderWorkflow } from './new-order-events.service.js';

export class NewOrderEventsQuery {
  @IsIn(['cashier', 'kitchen'])
  workflow!: OrderWorkflow;
}

@Controller('shops/:shopId/orders')
@RateLimit('stream')
export class NewOrderEventsController {
  constructor(private readonly events: NewOrderEventsService) {}

  @Get('events')
  @Roles(...SHOP_ROLES)
  stream(
    @Query() query: NewOrderEventsQuery,
    @Req() request: ShopMemberRequest,
    @Res() response: Response,
  ) {
    return this.events.stream(
      request.headers.authorization!.slice(7),
      request.shopMembership.shopId,
      query.workflow,
      response,
    );
  }
}
