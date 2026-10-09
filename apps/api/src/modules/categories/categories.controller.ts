import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  HttpCode,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { CreateCategoryDto } from './create-category.dto.js';
import { CategoriesService } from './categories.service.js';
import { UpdateCategoryDto } from './update-category.dto.js';
import { EmptyDto } from '../auth/dto/empty.dto.js';
import { CategoryVisibilityDto } from './category-visibility.dto.js';
import { ReorderCategoriesDto } from './reorder-categories.dto.js';
import {
  ShopResource,
  type ShopResourceRequest,
} from '../tenancy/shop-resource.guard.js';

@Controller('shops/:shopId/categories')
@Roles('OWNER', 'ADMIN', 'MANAGER')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}
  @Patch('reorder')
  reorder(
    @Body() dto: ReorderCategoriesDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.categories.reorder(req.user.id, req.shopMembership.shopId, dto);
  }
  @Patch(':categoryId/visibility')
  @ShopResource('category', 'categoryId')
  setVisibility(
    @Body() dto: CategoryVisibilityDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.categories.setVisibility(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Delete(':categoryId')
  @HttpCode(204)
  @ShopResource('category', 'categoryId')
  async delete(
    @Body() _dto: EmptyDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    await this.categories.delete(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
    );
  }
  @Patch(':categoryId')
  @ShopResource('category', 'categoryId')
  update(
    @Body() dto: UpdateCategoryDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.categories.update(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
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
