import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import { CreateTableDto } from './create-table.dto.js';
import { TablesService } from './tables.service.js';

@Controller('shops/:shopId/tables')
@Roles('OWNER', 'ADMIN')
export class TablesController {
  constructor(private readonly tables: TablesService) {}
  @Get()
  list(
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.tables.list(req.user.id, req.shopMembership.shopId);
  }
  @Post()
  create(
    @Body() dto: CreateTableDto,
    @Req() req: ShopMemberRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.tables.create(req.user.id, req.shopMembership.shopId, dto);
  }
}
