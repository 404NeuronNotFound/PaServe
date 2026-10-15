import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { AuthService } from '../auth/auth.service.js';
import { NewOrderEventsService } from './new-order-events.service.js';
import { CustomerOrderStatusService } from './customer-order-status.service.js';

function bearer(request: Request) {
  const match = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '');
  if (!match)
    throw new UnauthorizedException({
      code: 'RECEIPT_CREDENTIAL_REQUIRED',
      message: 'A valid order receipt is required.',
    });
  return match[1];
}

@Controller('menu/:shopSlug/orders/:orderId')
export class CustomerOrderStatusController {
  constructor(
    private readonly status: CustomerOrderStatusService,
    private readonly events: NewOrderEventsService,
  ) {}

  // Public customer routes use explicit receipt proof, never a number/UUID alone.
  @Get('status')
  read(
    @Param('shopSlug') slug: string,
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.status.read(slug, orderId, bearer(request));
  }

  @Get('events')
  async stream(
    @Param('shopSlug') slug: string,
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const token = bearer(request);
    const saved = await this.status.read(slug, orderId, token);
    const { shopId } = saved.order;
    return this.events.relay(
      `customer:confirmed:${shopId}:${orderId}`,
      'order_confirmed',
      { shopId, orderId },
      () => this.status.read(slug, orderId, token),
      response,
    );
  }
}

@Controller('shops/:shopId/orders')
export class ConfirmedOrderEventsController {
  constructor(
    private readonly events: NewOrderEventsService,
    private readonly auth: AuthService,
    private readonly members: ShopMembersService,
  ) {}

  @Get('confirmed-events')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'CASHIER')
  stream(@Req() request: ShopMemberRequest, @Res() response: Response) {
    const token = bearer(request),
      shopId = request.shopMembership.shopId;
    return this.events.relay(
      `staff:confirmed:${shopId}`,
      'order_confirmed',
      { shopId },
      async () => {
        const actor = await this.auth.currentUser(token);
        await this.members.requirePermission(
          actor.id,
          shopId,
          'shop.orders.read',
        );
      },
      response,
    );
  }
}
