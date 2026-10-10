import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import {
  ShopResource,
  type ShopResourceRequest,
} from '../tenancy/shop-resource.guard.js';
import { ProductVariantsService } from './product-variants.service.js';
import {
  CreateProductOptionGroupDto,
  CreateProductVariantDto,
  UpdateProductOptionGroupDto,
  UpdateProductVariantDto,
  CreateRegularVariantDto,
} from './product-variants.dto.js';

@Controller('shops/:shopId/products/:productId')
@Roles('OWNER', 'ADMIN', 'MANAGER')
@ShopResource('product', 'productId')
export class ProductVariantsController {
  constructor(private readonly variants: ProductVariantsService) {}
  @Post('variants/regular')
  createRegular(
    @Body() dto: CreateRegularVariantDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.variants.createRegular(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Get('variants')
  list(
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.variants.list(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
    );
  }
  @Post('option-groups')
  createGroup(
    @Body() dto: CreateProductOptionGroupDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.variants.createGroup(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Post('variants')
  createVariant(
    @Body() dto: CreateProductVariantDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.variants.createVariant(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Patch('option-groups/:optionGroupId')
  updateGroup(
    @Param('optionGroupId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProductOptionGroupDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.variants.updateGroup(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      id,
      dto,
    );
  }
  @Patch('variants/:variantId')
  updateVariant(
    @Param('variantId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProductVariantDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.variants.updateVariant(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      id,
      dto,
    );
  }
}
