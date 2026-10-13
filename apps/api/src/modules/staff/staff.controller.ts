import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../shop-members/decorators/roles.decorator.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth.guard.js';
import { StaffService } from './staff.service.js';
import {
  InvitationTokenDto,
  InviteStaffDto,
  StaffRoleDto,
} from './staff.dto.js';

@Controller('shops/:shopId/staff')
@Roles('OWNER')
export class StaffController {
  constructor(private readonly staff: StaffService) {}
  @Get()
  list(
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.staff.list(request.user.id, request.shopMembership.shopId);
  }
  @Post('invitations')
  invite(
    @Body() dto: InviteStaffDto,
    @Req() request: ShopMemberRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.staff.invite(
      request.user.id,
      request.shopMembership.shopId,
      dto,
    );
  }
  @Delete('invitations/:invitationId')
  @HttpCode(204)
  revoke(@Param('invitationId') id: string, @Req() request: ShopMemberRequest) {
    return this.staff.revoke(
      request.user.id,
      request.shopMembership.shopId,
      id,
    );
  }
  @Patch('members/:memberId')
  @HttpCode(204)
  changeRole(
    @Param('memberId') id: string,
    @Body() dto: StaffRoleDto,
    @Req() request: ShopMemberRequest,
  ) {
    return this.staff.changeRole(
      request.user.id,
      request.shopMembership.shopId,
      id,
      dto,
    );
  }
  @Delete('members/:memberId')
  @HttpCode(204)
  remove(@Param('memberId') id: string, @Req() request: ShopMemberRequest) {
    return this.staff.remove(
      request.user.id,
      request.shopMembership.shopId,
      id,
    );
  }
}

// Accepting an invitation precedes membership, so this identity-level action
// authenticates the actor, then checks the token/email/route shop atomically.
@Controller('staff-invitations/:shopId')
@UseGuards(JwtAuthGuard)
export class StaffInvitationController {
  constructor(private readonly staff: StaffService) {}
  @Post('preview')
  @HttpCode(200)
  preview(
    @Param('shopId') shopId: string,
    @Body() dto: InvitationTokenDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.staff.preview(request.user.id, shopId, dto.token);
  }
  @Post('accept')
  @HttpCode(200)
  accept(
    @Param('shopId') shopId: string,
    @Body() dto: InvitationTokenDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.staff.accept(request.user.id, shopId, dto.token);
  }
}
