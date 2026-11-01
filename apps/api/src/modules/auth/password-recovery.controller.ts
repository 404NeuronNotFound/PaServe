import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { REGISTRATION_LIMITS } from '@paserve/contracts';
import { EmailCodeDto } from './dto/identity.dto.js';
import { IdentityService } from './identity.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import { AuthOriginGuard } from './guards/auth-origin.guard.js';
import { AuthWorkInterceptor } from './auth-abuse-protection.js';
import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';

export class ResetPasswordDto extends EmailCodeDto {
  @IsString()
  @Matches(/^\d{6,8}$/u)
  code!: string;

  @IsString()
  @Matches(/\S/u)
  @MinLength(REGISTRATION_LIMITS.passwordMin)
  @MaxLength(REGISTRATION_LIMITS.passwordMax)
  password!: string;
}

@Controller('auth')
@UseGuards(AuthOriginGuard)
@UseInterceptors(AuthWorkInterceptor)
export class PasswordRecoveryController {
  constructor(
    private readonly identity: IdentityService,
    private readonly recovery: PasswordRecoveryService,
  ) {}

  @Post('forgot-password')
  @HttpCode(200)
  @RateLimit('register')
  request(@Body() input: EmailCodeDto) {
    return this.identity.sendRecoveryCode(input.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  @RateLimit('register')
  reset(@Body() input: ResetPasswordDto) {
    return this.recovery.reset(input);
  }
}
