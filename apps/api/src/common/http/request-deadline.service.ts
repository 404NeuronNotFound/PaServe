import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RateLimitPolicy } from '../rate-limiting/rate-limit.policy.js';

@Injectable()
export class RequestDeadlineService {
  private readonly read: number;
  private readonly write: number;
  private readonly auth: number;
  private readonly reports: number;
  private readonly upload: number;
  private readonly stream: number;
  private readonly health: number;

  constructor(config: ConfigService) {
    const duration = (name: string, fallback: number) => {
      const value = Number(config.get<string>(name) ?? fallback);
      if (!Number.isInteger(value) || value < 100 || value > 120_000)
        throw new Error(`${name} must be an integer between 100 and 120000`);
      return value;
    };
    this.read = duration('API_READ_TIMEOUT_MS', 15_000);
    this.write = duration('API_WRITE_TIMEOUT_MS', 45_000);
    this.auth = duration('API_AUTH_TIMEOUT_MS', 10_000);
    this.reports = duration('API_REPORT_TIMEOUT_MS', 30_000);
    this.upload = duration('API_UPLOAD_TIMEOUT_MS', 30_000);
    this.stream = duration('API_STREAM_SETUP_TIMEOUT_MS', 10_000);
    this.health = duration('API_HEALTH_TIMEOUT_MS', 3_000);
  }

  forRequest(method: string, policy?: RateLimitPolicy, health = false): number {
    if (health) return this.health;
    if (policy === 'stream') return this.stream;
    if (policy === 'reports') return this.reports;
    if (policy === 'upload') return this.upload;
    if (policy === 'login' || policy === 'register' || policy === 'refresh')
      return this.auth;
    return method === 'GET' || method === 'HEAD' ? this.read : this.write;
  }
}
