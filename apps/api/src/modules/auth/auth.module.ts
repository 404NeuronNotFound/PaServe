import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { DatabaseModule } from '../../database/database.module.js';
import { JwtModule } from '@nestjs/jwt';
import { TokensService } from './tokens.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuthOriginGuard } from './guards/auth-origin.guard.js';
import { BotChallengeService } from './bot-challenge.service.js';
import { PasswordHashService } from './password-hash.service.js';
import {
  AuthAbuseProtection,
  AuthWorkInterceptor,
} from './auth-abuse-protection.js';

@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    PasswordHashService,
    BotChallengeService,
    AuthAbuseProtection,
    AuthWorkInterceptor,
    AuthService,
    AuthRepository,
    TokensService,
    JwtAuthGuard,
    AuthOriginGuard,
  ],
  exports: [JwtAuthGuard, AuthService],
})
export class AuthModule {}
