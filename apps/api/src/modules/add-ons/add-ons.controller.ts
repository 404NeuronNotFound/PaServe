import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import {
  ShopResource,
  type ShopResourceRequest,
} from '../tenancy/shop-resource.guard.js';
import { AddOnsService } from './add-ons.service.js';
import {
  CreateAddOnDto,
  UpdateAddOnDto,
  AssignProductAddOnDto,
  AddOnSelectionDto,
  CreateExtraShotDto,
  CreateOatMilkDto,
} from './add-ons.dto.js';

@Controller('shops/:shopId/add-ons')
@Roles('OWNER', 'ADMIN', 'MANAGER')
export class AddOnsController {
  constructor(private readonly addOns: AddOnsService) {}
  @Delete(':addOnId')
  @HttpCode(204)
  @ShopResource('addOn', 'addOnId')
  delete(
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.delete(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
    );
  }
  @Post('oat-milk')
  createOatMilk(
    @Body() dto: CreateOatMilkDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.createOatMilk(
      req.user.id,
      req.shopMembership.shopId,
      dto,
    );
  }
  @Post('extra-shot')
  createExtraShot(
    @Body() dto: CreateExtraShotDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.createExtraShot(
      req.user.id,
      req.shopMembership.shopId,
      dto,
    );
  }
  @Get()
  list(
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.list(req.user.id, req.shopMembership.shopId);
  }
  @Post()
  create(
    @Body() dto: CreateAddOnDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.create(req.user.id, req.shopMembership.shopId, dto);
  }
  @Patch(':addOnId')
  @ShopResource('addOn', 'addOnId')
  update(
    @Body() dto: UpdateAddOnDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.update(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto,
    );
  }
}
@Controller('shops/:shopId/products/:productId/add-ons')
@Roles('OWNER', 'ADMIN', 'MANAGER')
@ShopResource('product', 'productId')
export class ProductAddOnsController {
  constructor(private readonly addOns: AddOnsService) {}
  @Get()
  list(
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.productList(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
    );
  }
  @Post()
  assign(
    @Body() dto: AssignProductAddOnDto,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.assign(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      dto.addOnId,
    );
  }
  @Delete(':addOnId')
  unassign(
    @Param('addOnId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: ShopResourceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.unassign(
      req.user.id,
      req.shopResource.shopId,
      req.shopResource.id,
      id,
    );
  }
}
@Controller('menu/:shopSlug/products/:productId/add-ons')
export class PublicAddOnsController {
  constructor(private readonly addOns: AddOnsService) {}
  @Get()
  list(
    @Param('shopSlug') slug: string,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.publicList(slug, productId);
  }
  @Post('quote')
  quote(
    @Param('shopSlug') slug: string,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: AddOnSelectionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.addOns.quote(slug, productId, dto);
  }
}
