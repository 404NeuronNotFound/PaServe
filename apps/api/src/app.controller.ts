import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';
import { CapacityLiveness } from './common/load-shedding/api-admission.guard.js';
import { CapacityReadiness } from './common/load-shedding/critical-capacity.js';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

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
