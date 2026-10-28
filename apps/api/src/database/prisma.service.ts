import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseTimeouts } from './database-timeouts.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined');
    }

    const deadlines = databaseTimeouts(process.env);
    const adapter = new PrismaPg({
      connectionString,
      ...deadlines.pool,
    });

    super({
      adapter,
      transactionOptions: deadlines.transactionOptions,
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
