import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { DatabaseModule } from '../../database/database.module.js';
import { JwtModule } from '@nestjs/jwt';
import { TokensService } from './tokens.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuthOriginGuard } from './guards/auth-origin.guard.js';

@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    TokensService,
    JwtAuthGuard,
    AuthOriginGuard,
  ],
  exports: [JwtAuthGuard, AuthService],
})
export class AuthModule {}
