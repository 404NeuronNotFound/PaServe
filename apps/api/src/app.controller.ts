import { Controller, Get, Optional } from '@nestjs/common';
import { SharedSecurityState } from './common/rate-limiting/shared-security-state.js';
import { PrismaService } from './database/prisma.service.js';
import { CapacityLiveness } from './common/load-shedding/api-admission.guard.js';
import { CapacityReadiness } from './common/load-shedding/critical-capacity.js';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly security?: SharedSecurityState,
  ) {}

  @Get()
  getRoot() {
    return {
      app: 'PaServe API',
      status: 'running',
    };
  }

  @Get('health')
  @CapacityReadiness()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    if (this.security?.enabled)
      await this.security.operate('health:security-schema', 'read');

    return {
      api: 'ok',
      database: 'connected',
    };
  }

  @Get('health/live')
  @CapacityLiveness()
  live() {
    return { api: 'ok' };
  }
}
