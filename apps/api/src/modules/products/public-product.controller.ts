import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import { MenuReadCapacity } from '../../common/load-shedding/menu-read-capacity.js';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PublicProductService } from './public-product.service.js';
import { ProductSelectionDto } from './public-product.dto.js';

@Controller('menu/:shopSlug/products/:productId')
@RateLimit('publicRead')
export class PublicProductController {
  constructor(private readonly products: PublicProductService) {}
  @Get()
  @MenuReadCapacity()
  details(
    @Param('shopSlug') slug: string,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.details(slug, id);
  }
  @RateLimit('quote')
  @Post('quote')
  quote(
    @Param('shopSlug') slug: string,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ProductSelectionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.products.quote(slug, id, dto);
  }
}
