import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiRateLimitGuard } from './api-rate-limit.guard.js';

@Global()
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  providers: [
    ApiRateLimitGuard,
    { provide: APP_GUARD, useExisting: ApiRateLimitGuard },
  ],
  exports: [ApiRateLimitGuard, ThrottlerModule],
})
export class RateLimitingModule {}
