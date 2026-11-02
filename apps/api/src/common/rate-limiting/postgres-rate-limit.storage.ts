import type { ThrottlerStorage } from '@nestjs/throttler';
import { SharedSecurityState } from './shared-security-state.js';

export class PostgresRateLimitStorage implements ThrottlerStorage {
  constructor(private readonly state: SharedSecurityState) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ) {
    const result = await this.state.operate(
      `rate:${throttlerName}:${key}:${ttl}`,
      'rate',
      ttl,
      limit,
    );
    return {
      totalHits: result.hits,
      timeToExpire: result.retry,
      isBlocked: !result.accepted,
      timeToBlockExpire: result.accepted ? 0 : result.retry,
    };
  }
}
