import { CriticalCapacity } from '../../common/load-shedding/critical-capacity.js';
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
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { PreparationCompleteService } from './preparation-complete.service.js';

@CriticalCapacity()
@Controller('shops/:shopId/orders')
export class PreparationCompleteController {
  constructor(private readonly preparation: PreparationCompleteService) {}
  @Post(':orderId/complete')
  @HttpCode(200)
  @Permissions('shop.preparation.status.update')
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
