import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool, PoolClient, PoolConfig } from 'pg';
import type { DatabasePoolPolicy } from './database-pool.policy.js';
import { DatabaseQueryMetrics } from './database-query.metrics.js';

type Queryable = Pick<
  Awaited<ReturnType<PrismaPg['connect']>>,
  'queryRaw' | 'executeRaw'
>;

/** A safe structured tag survives the pg adapter's error conversion. */
class PoolBusyError extends Error {
  readonly code = '53300';
  readonly severity = 'ERROR';
  constructor() {
    super('Database connection capacity is temporarily unavailable.');
  }
}
type CheckoutCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  release: (error?: Error | boolean) => void,
) => void;

export class BoundedPgAdapter extends PrismaPg {
  private pool?: Pool;
  private readonly queryMetrics = new DatabaseQueryMetrics();
  private readonly acquisitionTiming = {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    boundsMs: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 3000],
    buckets: Array<number>(11).fill(0),
  };
  private readonly counts = {
    generations: 0,
    connected: 0,
    acquired: 0,
    released: 0,
    removed: 0,
    rejected: 0,
    acquisitionFailures: 0,
    idleErrors: 0,
    peakTotal: 0,
    peakWaiting: 0,
    peakPendingCheckouts: 0,
  };

  constructor(
    config: PoolConfig,
    readonly policy: DatabasePoolPolicy,
  ) {
    super({
      ...config,
      max: policy.max,
      min: 0,
      idleTimeoutMillis: policy.idleTimeoutMillis,
      maxLifetimeSeconds: policy.maxLifetimeSeconds,
      keepAlive: true,
      application_name: 'paserve-api',
    });
  }

  override async connect(): ReturnType<PrismaPg['connect']> {
    const adapter = await super.connect();
    this.observeQueries(adapter);
    const startTransaction = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (isolationLevel) => {
      const transaction = await startTransaction(isolationLevel);
      this.observeQueries(transaction);
      return transaction;
    };
    const pool = adapter.underlyingDriver();
    // Prisma creates a lazy pool per engine lifecycle. Wrap every generation,
    // including reconnect after $disconnect; ownership/disposal stays with Prisma.
    if (this.pool !== pool) {
      this.pool = pool;
      this.counts.generations++;
      this.attach(pool);
    }
    return adapter;
  }

  private observeQueries(queryable: Queryable) {
    const query = queryable.queryRaw.bind(queryable);
    const execute = queryable.executeRaw.bind(queryable);
    queryable.queryRaw = (sql) => this.queryMetrics.observe(() => query(sql));
    queryable.executeRaw = (sql) =>
      this.queryMetrics.observe(() => execute(sql));
  }

  private attach(pool: Pool) {
    const original = pool.connect.bind(pool);
    const markPeaks = () => {
      this.counts.peakTotal = Math.max(this.counts.peakTotal, pool.totalCount);
      this.counts.peakWaiting = Math.max(
        this.counts.peakWaiting,
        Math.max(0, pool.waitingCount - pool.idleCount),
      );
      this.counts.peakPendingCheckouts = Math.max(
        this.counts.peakPendingCheckouts,
        pool.waitingCount,
      );
    };
    const checkout = (callback: CheckoutCallback) => {
      const started = performance.now();
      const finish: CheckoutCallback = (error, client, release) => {
        const elapsed = performance.now() - started;
        const timing = this.acquisitionTiming;
        timing.count++;
        timing.totalMs += elapsed;
        timing.maxMs = Math.max(timing.maxMs, elapsed);
        const bucket = timing.boundsMs.findIndex((bound) => elapsed <= bound);
        timing.buckets[bucket === -1 ? timing.boundsMs.length : bucket]++;
        callback(error, client, release);
      };
      // pg schedules idle-client handoffs on nextTick. Reserve those idle slots
      // before counting parked waiters so bursts can reuse *all* idle clients.
      const available =
        Math.max(0, pool.idleCount - pool.waitingCount) +
        Math.max(0, this.policy.max - pool.totalCount);
      const waiting = Math.max(0, pool.waitingCount - pool.idleCount);
      if (
        !pool.ending &&
        available === 0 &&
        waiting >= this.policy.maxWaiting
      ) {
        this.counts.rejected++;
        queueMicrotask(() => finish(new PoolBusyError(), undefined, () => {}));
        return;
      }
      original((error, client, release) => {
        if (error) {
          this.counts.acquisitionFailures++;
          finish(new PoolBusyError(), undefined, () => {});
        } else finish(undefined, client, release);
      });
      markPeaks();
    };
    function connect(): Promise<PoolClient>;
    function connect(callback: CheckoutCallback): void;
    function connect(callback?: CheckoutCallback): Promise<PoolClient> | void {
      if (callback) {
        checkout(callback);
        return;
      }
      return new Promise<PoolClient>((resolve, reject) =>
        checkout((error, client) => {
          if (error) reject(error);
          else resolve(client!);
        }),
      );
    }
    pool.connect = connect;
    pool.on('connect', () => {
      this.counts.connected++;
      markPeaks();
    });
    pool.on('acquire', () => {
      this.counts.acquired++;
      markPeaks();
    });
    pool.on('release', () => {
      this.counts.released++;
    });
    pool.on('remove', () => {
      this.counts.removed++;
    });
    // Prisma also owns an idle-error listener. Count without logging raw errors,
    // SQL, hosts, connection strings or credentials for every failed client.
    pool.on('error', () => {
      this.counts.idleErrors++;
    });
  }

  snapshot() {
    const pool = this.pool;
    return {
      policy: this.policy,
      state: !pool
        ? 'not-created'
        : pool.ended
          ? 'closed'
          : pool.ending
            ? 'closing'
            : 'open',
      total: pool?.totalCount ?? 0,
      idle: pool?.idleCount ?? 0,
      waiting: pool ? Math.max(0, pool.waitingCount - pool.idleCount) : 0,
      pendingCheckouts: pool?.waitingCount ?? 0,
      queryWorkloads: this.queryMetrics.snapshot(),
      acquisitionTiming: {
        ...this.acquisitionTiming,
        boundsMs: [...this.acquisitionTiming.boundsMs],
        buckets: [...this.acquisitionTiming.buckets],
      },
      ...this.counts,
    };
  }
}
