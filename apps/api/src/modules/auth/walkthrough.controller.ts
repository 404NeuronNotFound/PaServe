import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from './guards/jwt-auth.guard.js';
import { AuthOriginGuard } from './guards/auth-origin.guard.js';
import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import { WalkthroughService } from './walkthrough.service.js';
import { WalkthroughCompletionDto } from './dto/walkthrough.dto.js';
@Controller('auth/walkthrough')
export class WalkthroughController {
  constructor(private readonly walkthrough: WalkthroughService) {}
  @Get()
  @RateLimit('session')
  @UseGuards(JwtAuthGuard)
  progress(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.walkthrough.progress(request.user.id);
  }
  @Post()
  @HttpCode(200)
  @RateLimit('accountUpdate')
  @UseGuards(AuthOriginGuard, JwtAuthGuard)
  complete(
    @Body() input: WalkthroughCompletionDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.walkthrough.complete(request.user, input);
  }
}
