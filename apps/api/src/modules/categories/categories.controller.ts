import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { CreateCategoryDto } from './create-category.dto.js';
import { CategoriesService } from './categories.service.js';

@Controller('shops/:shopId/categories')
@Roles('OWNER', 'ADMIN', 'MANAGER')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}
  @Get()
  list(
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.categories.list(req.user.id, req.shopMembership.shopId);
  }
  @Post()
  create(
    @Body() dto: CreateCategoryDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.categories.create(req.user.id, req.shopMembership.shopId, dto);
  }
}
