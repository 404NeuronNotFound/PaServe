import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { AuthService } from '../auth/auth.service.js';
import { NewOrderEventsService } from './new-order-events.service.js';
import { CustomerOrderStatusService } from './customer-order-status.service.js';
import {
  setTrackingCookie,
  trackingCredential,
} from './guest-tracking-cookie.js';

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
@RateLimit('receiptRead')
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
    response.setHeader('Referrer-Policy', 'no-referrer');
    return this.status.read(slug, orderId, trackingCredential(request));
  }

  @RateLimit('receiptProof')
  @Post('tracking-session')
  async establish(
    @Param('shopSlug') slug: string,
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const token = bearer(request);
    const saved = await this.status.read(slug, orderId, token);
    const claims = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
    ) as { exp: number };
    setTrackingCookie(response, slug, orderId, token, new Date(claims.exp));
    return saved;
  }

  @RateLimit('receiptProof')
  @Get('tracking-link')
  async share(
    @Param('shopSlug') slug: string,
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const token = trackingCredential(request);
    await this.status.read(slug, orderId, token);
    return { trackingToken: token };
  }

  @RateLimit('stream')
  @Get('events')
  async stream(
    @Param('shopSlug') slug: string,
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const token = trackingCredential(request);
    response.setHeader('Referrer-Policy', 'no-referrer');
    const saved = await this.status.read(slug, orderId, token);
    const { shopId } = saved.order;
    return this.events.relay(
      `customer:confirmed:${shopId}:${orderId}`,
      ['order_confirmed', 'order_preparing', 'order_ready', 'order_completed'],
      { shopId, orderId },
      () => this.status.read(slug, orderId, token),
      response,
    );
  }
}

@Controller('shops/:shopId/orders')
@RateLimit('stream')
export class ConfirmedOrderEventsController {
  constructor(
    private readonly events: NewOrderEventsService,
    private readonly auth: AuthService,
    private readonly members: ShopMembersService,
  ) {}

  @Get('confirmed-events')
  @Permissions('shop.orders.read')
  stream(@Req() request: ShopMemberRequest, @Res() response: Response) {
    const token = bearer(request),
      shopId = request.shopMembership.shopId;
    return this.events.relay(
      `staff:confirmed:${shopId}`,
      ['order_confirmed', 'order_preparing', 'order_ready', 'order_completed'],
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

  @Get('preparation-events')
  @Permissions('shop.preparation.queue.read')
  preparationStream(
    @Req() request: ShopMemberRequest,
    @Res() response: Response,
  ) {
    const token = bearer(request),
      shopId = request.shopMembership.shopId;
    return this.events.relay(
      `staff:preparation:${shopId}`,
      ['order_preparing', 'order_ready', 'order_completed'],
      { shopId },
      async () => {
        const actor = await this.auth.currentUser(token);
        await this.members.requirePermission(
          actor.id,
          shopId,
          'shop.preparation.queue.read',
        );
      },
      response,
    );
  }
}
