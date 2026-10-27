import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AuthAbuseProtection } from '../src/modules/auth/auth-abuse-protection.js';
import { BotChallengeService } from '../src/modules/auth/bot-challenge.service.js';

/** Isolate HTTP examples while preserving real limit enforcement inside each test. */
export function resetRateLimits(app: INestApplication): void {
  app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  app.get(AuthAbuseProtection).onApplicationShutdown();
  app.get(BotChallengeService).onApplicationShutdown();
}
