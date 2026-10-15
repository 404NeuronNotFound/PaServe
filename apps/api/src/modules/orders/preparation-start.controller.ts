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
  PREPARATION_START_ROLES,
  PreparationStartService,
} from './preparation-start.service.js';

@Controller('shops/:shopId/orders')
export class PreparationStartController {
  constructor(private readonly preparation: PreparationStartService) {}

  @Post(':orderId/start-preparing')
  @HttpCode(200)
  @Roles(...PREPARATION_START_ROLES)
  start(
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
        code: 'INVALID_PREPARATION_START',
        message: 'Preparation start does not accept client-supplied fields.',
      });
    return this.preparation.start(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
    );
  }
}
