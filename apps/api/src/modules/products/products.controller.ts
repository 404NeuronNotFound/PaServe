import { Controller, Body, Post, Get, Patch, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ProductsService } from './products.service.js';
import { CreateProductDto } from './create-product.dto.js';
import { UpdateProductDto } from './update-product.dto.js';
import { ProductArchiveDto } from './product-archive.dto.js';
import {
  ShopResource,
  type ShopResourceRequest,
} from '../tenancy/shop-resource.guard.js';

@Controller('shops/:shopId/products')
@Roles('OWNER', 'ADMIN', 'MANAGER')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}
  @Patch(':productId/archive')
  @ShopResource('product', 'productId')
  setArchived(
    @Body() dto: ProductArchiveDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.setArchived(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Patch(':productId')
  @ShopResource('product', 'productId')
  update(
    @Body() dto: UpdateProductDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.update(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Post()
  create(
    @Body() dto: CreateProductDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.create(req.user.id, req.shopMembership.shopId, dto);
  }
  @Get()
  list(
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.list(req.user.id, req.shopMembership.shopId);
  }
}
