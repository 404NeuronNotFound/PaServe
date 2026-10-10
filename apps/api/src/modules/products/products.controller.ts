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
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ProductsService } from './products.service.js';
import { CreateProductDto } from './create-product.dto.js';
import { UpdateProductDto } from './update-product.dto.js';
import { ProductArchiveDto } from './product-archive.dto.js';
import { ProductAvailableDto } from './product-available.dto.js';
import { ProductFeaturedDto } from './product-featured.dto.js';
import {
  ShopResource,
  type ShopResourceRequest,
} from '../tenancy/shop-resource.guard.js';

@Controller('shops/:shopId/products')
@Roles('OWNER', 'ADMIN', 'MANAGER')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly images: ProductImageService,
  ) {}
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
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'CASHIER')
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
  @Roles('OWNER', 'ADMIN', 'MANAGER')
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
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'CASHIER')
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
  @Post(':productId/image')
  @ShopResource('product', 'productId')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: PRODUCT_IMAGE_LIMITS.maxBytes,
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
