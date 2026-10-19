import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

/** Isolate HTTP examples while preserving real limit enforcement inside each test. */
export function resetRateLimits(app: INestApplication): void {
  app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
}
