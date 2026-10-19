import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import {
  Controller,
  Body,
  Post,
  Get,
  Patch,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PRODUCT_IMAGE_LIMITS } from '@paserve/contracts';
import { ProductImageService } from './product-image.service.js';
import type { ProductImageFile } from './product-image.processor.js';
import { EmptyDto } from '../auth/dto/empty.dto.js';
import type { Response } from 'express';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ProductsService } from './products.service.js';
import { CreateProductDto } from './create-product.dto.js';
import { UpdateProductDto } from './update-product.dto.js';
import { ProductArchiveDto } from './product-archive.dto.js';
import { ProductAvailableDto } from './product-available.dto.js';
import { ProductFeaturedDto } from './product-featured.dto.js';
import { ReorderProductsDto } from './reorder-products.dto.js';
import { ReorderFeaturedProductsDto } from './reorder-featured-products.dto.js';
import {
  ShopResource,
  type ShopResourceRequest,
} from '../tenancy/shop-resource.guard.js';

@Controller('shops/:shopId/products')
@Permissions('shop.menu.manage')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly images: ProductImageService,
  ) {}
  @Patch('reorder')
  reorder(
    @Body() dto: ReorderProductsDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.reorder(req.user.id, req.shopMembership.shopId, dto);
  }
  @Patch('featured/reorder')
  reorderFeatured(
    @Body() dto: ReorderFeaturedProductsDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.reorderFeatured(
      req.user.id,
      req.shopMembership.shopId,
      dto,
    );
  }
  @Patch(':productId/featured')
  @ShopResource('product', 'productId')
  setFeatured(
    @Body() dto: ProductFeaturedDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.setFeatured(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Patch(':productId/available')
  @Permissions('shop.menu.availability.update')
  @ShopResource('product', 'productId')
  setAvailable(
    @Body() dto: ProductAvailableDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.setAvailable(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Patch(':productId/hidden')
  @Permissions('shop.menu.manage')
  @ShopResource('product', 'productId')
  setHidden(
    @Body() dto: ProductAvailableDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.setHidden(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @Patch(':productId/sold-out')
  @Permissions('shop.menu.availability.update')
  @ShopResource('product', 'productId')
  setSoldOut(
    @Body() dto: ProductAvailableDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.setSoldOut(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
  @RateLimit('upload')
  @Post(':productId/image')
  @ShopResource('product', 'productId')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        // Busboy truncates at its limit; allow the inclusive maximum through to validation.
        fileSize: PRODUCT_IMAGE_LIMITS.maxBytes + 1,
        files: 1,
        fields: 0,
        parts: 2,
      },
    }),
  )
  uploadImage(
    @UploadedFile() file: ProductImageFile | undefined,
    @Body() _dto: EmptyDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.images.upload(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      file,
    );
  }
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
