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
  PREPARATION_COMPLETE_ROLES,
  PreparationCompleteService,
} from './preparation-complete.service.js';

@Controller('shops/:shopId/orders')
export class PreparationCompleteController {
  constructor(private readonly preparation: PreparationCompleteService) {}
  @Post(':orderId/complete')
  @HttpCode(200)
  @Roles(...PREPARATION_COMPLETE_ROLES)
  complete(
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
        code: 'INVALID_ORDER_COMPLETION',
        message: 'Completion does not accept client-supplied fields.',
      });
    return this.preparation.complete(
      request.user.id,
      request.shopMembership.shopId,
      orderId,
    );
  }
}
