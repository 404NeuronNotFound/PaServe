import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SHOP_BANNER_LIMITS } from '@paserve/contracts';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { EmptyDto } from '../auth/dto/empty.dto.js';
import { Permissions } from '../shop-members/decorators/permissions.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ShopBannerService } from './shop-banner.service.js';
import type { ShopBannerFile } from './shop-banner.processor.js';

@Controller('shops/:shopId/banner')
@UseGuards(JwtAuthGuard)
@Permissions('shop.settings.manage')
export class ShopBannerController {
  constructor(private readonly banners: ShopBannerService) {}

  @RateLimit('upload')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        // Busboy truncates at its limit; allow the inclusive maximum through to validation.
        fileSize: SHOP_BANNER_LIMITS.maxBytes + 1,
        files: 1,
        fields: 0,
        parts: 2,
      },
    }),
  )
  upload(
    @UploadedFile() file: ShopBannerFile | undefined,
    @Body() _dto: EmptyDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.banners.upload(req.user.id, req.shopMembership.shopId, file);
  }
}
