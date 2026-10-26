import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth.guard.js';
import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import { AccountNotificationsService } from './account-notifications.service.js';
import { StaffService } from './staff.service.js';

// Identity-level routes intentionally precede shop membership. The inbox is
// always scoped to the authenticated account, including after access removal.
@Controller('account/notifications')
@UseGuards(JwtAuthGuard)
export class AccountNotificationsController {
  constructor(
    private readonly notifications: AccountNotificationsService,
    private readonly staff: StaffService,
  ) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.notifications.list(req.user.id, cursor);
  }
  @Patch('read')
  @HttpCode(204)
  readAll(@Req() req: AuthenticatedRequest) {
    return this.notifications.markRead(req.user.id);
  }
  @Patch(':id/read')
  @HttpCode(204)
  read(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.notifications.markRead(req.user.id, id);
  }
  @Post('invitations/:shopId/:id/accept')
  @RateLimit('invitationProof')
  @HttpCode(200)
  accept(
    @Req() req: AuthenticatedRequest,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.staff.accept(req.user.id, shopId, id, true);
  }
  @Post('invitations/:shopId/:id/decline')
  @RateLimit('invitationProof')
  @HttpCode(204)
  decline(
    @Req() req: AuthenticatedRequest,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.staff.decline(req.user.id, shopId, id);
  }
}
