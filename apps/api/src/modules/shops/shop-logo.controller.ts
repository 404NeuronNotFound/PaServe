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
import { SHOP_LOGO_LIMITS } from '@paserve/contracts';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { EmptyDto } from '../auth/dto/empty.dto.js';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { ShopLogoService } from './shop-logo.service.js';
import type { ShopLogoFile } from './shop-logo.processor.js';

@Controller('shops/:shopId/logo')
@UseGuards(JwtAuthGuard)
@Roles('OWNER')
export class ShopLogoController {
  constructor(private readonly logos: ShopLogoService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: SHOP_LOGO_LIMITS.maxBytes,
        files: 1,
        fields: 0,
        parts: 2,
      },
    }),
  )
  upload(
    @UploadedFile() file: ShopLogoFile | undefined,
    @Body() _dto: EmptyDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.logos.upload(req.user.id, req.shopMembership.shopId, file);
  }
}
