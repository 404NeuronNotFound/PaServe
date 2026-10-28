import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';
import { databaseTimeouts } from './database-timeouts.js';
import { BoundedPgAdapter } from './bounded-pg.adapter.js';
import { databasePoolPolicy } from './database-pool.policy.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly poolAdapter: BoundedPgAdapter;
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined');
    }

    const deadlines = databaseTimeouts(process.env);
    const adapter = new BoundedPgAdapter(
      {
        connectionString,
        ...deadlines.pool,
      },
      databasePoolPolicy(process.env),
    );

    super({
      adapter,
      transactionOptions: deadlines.transactionOptions,
    });
    this.poolAdapter = adapter;
  }

  /** Internal aggregate metrics only; never exposes pool options/credentials. */
  databasePoolSnapshot() {
    return this.poolAdapter.snapshot();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
