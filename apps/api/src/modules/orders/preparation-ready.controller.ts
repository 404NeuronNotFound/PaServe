import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import {
  PREPARATION_READY_ROLES,
  PreparationReadyService,
} from './preparation-ready.service.js';

@Controller('shops/:shopId/orders')
export class PreparationReadyController {
  constructor(private readonly preparation: PreparationReadyService) {}

  @Post(':orderId/mark-ready')
  @HttpCode(200)
  @Roles(...PREPARATION_READY_ROLES)
  ready(
    @Param('orderId') orderId: string,
    @Body() body: unknown,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    if (
      body !== undefined &&
      (body === null ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length)
    )
      throw new BadRequestException({
        code: 'INVALID_PREPARATION_READY',
        message: 'Mark ready does not accept client-supplied fields.',
      });
    return this.preparation.ready(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
    );
  }
}
