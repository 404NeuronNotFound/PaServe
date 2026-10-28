import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CriticalAccessService } from '../load-shedding/critical-capacity.js';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiCapacityService } from '../load-shedding/api-capacity.service.js';
import { ApiAdmissionGuard } from '../load-shedding/api-admission.guard.js';
import { ApiWorkInterceptor } from '../load-shedding/api-work.interceptor.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiRateLimitGuard } from './api-rate-limit.guard.js';
import { RequestDeadlineService } from '../http/request-deadline.service.js';

@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  providers: [
    ApiCapacityService,
    RequestDeadlineService,
    CriticalAccessService,
    { provide: APP_GUARD, useClass: ApiAdmissionGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiWorkInterceptor },
    ApiRateLimitGuard,
    { provide: APP_GUARD, useExisting: ApiRateLimitGuard },
  ],
  exports: [ApiRateLimitGuard, ThrottlerModule, ApiCapacityService],
})
export class RateLimitingModule {}
