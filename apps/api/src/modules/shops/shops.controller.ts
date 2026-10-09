import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ShopMembershipResponse } from '@paserve/contracts';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth.guard.js';
import { ShopsService } from './shops.service.js';
import { CreateShopDto } from './dto/create-shop.dto.js';
import {
  ShopMembershipGuard,
  type ShopMemberRequest,
} from '../shop-members/guards/shop-membership.guard.js';

@Controller('shops')
@UseGuards(JwtAuthGuard)
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get(':shopId/membership')
  @UseGuards(ShopMembershipGuard)
  membership(
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ): ShopMembershipResponse {
    response.setHeader('Cache-Control', 'no-store');
    return { membership: request.shopMembership };
  }

  @Post()
  create(
    @Body() dto: CreateShopDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.shops.create(request.user.id, dto);
  }
}
