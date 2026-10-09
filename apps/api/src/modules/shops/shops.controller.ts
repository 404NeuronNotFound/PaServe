import {
  Body,
  Controller,
  Get,
  Patch,
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
import { UpdateShopDto } from './dto/update-shop.dto.js';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import {
  ShopMembershipGuard,
  type ShopMemberRequest,
} from '../shop-members/guards/shop-membership.guard.js';

@Controller('shops')
@UseGuards(JwtAuthGuard)
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get(':shopId/settings')
  @Roles('OWNER')
  settings(
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.shops.getSettings(
      request.user.id,
      request.shopMembership.shopId,
    );
  }

  @Patch(':shopId')
  @Roles('OWNER')
  updateSettings(
    @Body() dto: UpdateShopDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.shops.updateSettings(
      request.user.id,
      request.shopMembership.shopId,
      dto,
    );
  }

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
