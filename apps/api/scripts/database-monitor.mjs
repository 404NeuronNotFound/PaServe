import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// No SQL text, parameters, identities, table rows or connection strings are selected.
export const databaseSampleSql = `WITH activity AS MATERIALIZED (
  SELECT backend_type,state,wait_event_type,query_start,xact_start
  FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
) SELECT clock_timestamp() AS "sampledAt", stats_reset AS "statsReset",
  current_setting('track_activities')='on' AS "activitiesTracked",
  current_setting('track_counts')='on' AS "countsTracked",
  current_setting('track_io_timing')='on' AS "ioTimingEnabled",
  (SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','MEMBER')
    FROM pg_roles WHERE rolname=current_user) AS "fullVisibility",
  current_setting('max_connections')::int AS "serverMaxConnections",
  (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type='client backend') AS "serverClientConnections",
  (SELECT count(*)::int FROM activity WHERE backend_type='client backend') AS "clientConnections",
  (SELECT count(*)::int FROM activity WHERE backend_type<>'client backend') AS "backgroundConnections",
  (SELECT count(*)::int FROM activity WHERE state='active') AS active,
  (SELECT count(*)::int FROM activity WHERE state LIKE 'idle in transaction%') AS "idleInTransaction",
  (SELECT count(*)::int FROM activity WHERE wait_event_type='Lock') AS "lockWaiters",
  (SELECT count(*)::int FROM activity WHERE wait_event_type='IO') AS "ioWaiters",
  (SELECT count(*)::int FROM activity WHERE state='active' AND query_start<clock_timestamp()-interval '1 second') AS "slowActiveQueries",
  COALESCE((SELECT max(EXTRACT(epoch FROM clock_timestamp()-query_start)*1000) FROM activity WHERE state='active'),0)::float8 AS "oldestActiveMs",
  COALESCE((SELECT max(EXTRACT(epoch FROM clock_timestamp()-xact_start)*1000) FROM activity WHERE xact_start IS NOT NULL),0)::float8 AS "oldestTransactionMs",
  xact_commit::float8 AS commits,xact_rollback::float8 AS rollbacks,
  deadlocks::float8 AS deadlocks,temp_bytes::float8 AS "tempBytes",
  blks_hit::float8 AS "blocksHit",blks_read::float8 AS "blocksRead",
  blk_read_time AS "blockReadMs",blk_write_time AS "blockWriteMs"
  FROM pg_stat_database WHERE datname=current_database()`;

const counters = [
  'commits',
  'rollbacks',
  'deadlocks',
  'tempBytes',
  'blocksHit',
  'blocksRead',
  'blockReadMs',
  'blockWriteMs',
];
// Stable catalog order avoids silently tracking only a changing "top N".
export const relationSizeSql = `SELECT c.oid::text AS "relationId",
  c.relfilenode::text AS generation,n.nspname AS schema,c.relname AS name,
  CASE WHEN c.relkind='i' THEN 'index' ELSE 'table' END AS kind,
  CASE WHEN c.relkind='i' THEN pg_relation_size(c.oid) ELSE pg_table_size(c.oid) END::float8 AS bytes,
  CASE WHEN c.relkind='r' THEN pg_indexes_size(c.oid) ELSE 0 END::float8 AS "indexBytes"
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','i')
  ORDER BY c.oid LIMIT 601`;

export function relationGrowth(previous, current) {
  if (!previous) return { status: 'baseline', changes: [] };
  const before = new Map(previous.map((row) => [row.relationId, row]));
  const changes = current.map((row) => {
    const old = before.get(row.relationId);
    before.delete(row.relationId);
    return {
      relationId: row.relationId,
      schema: row.schema,
      name: row.name,
      kind: row.kind,
      status: !old
        ? 'created'
        : old.generation !== row.generation
          ? 'rewritten'
          : 'existing',
      bytesDelta:
        old && old.generation === row.generation ? row.bytes - old.bytes : null,
      indexBytesDelta:
        old && old.generation === row.generation
          ? row.indexBytes - old.indexBytes
          : null,
    };
  });
  for (const old of before.values())
    changes.push({
      relationId: old.relationId,
      schema: old.schema,
      name: old.name,
      kind: old.kind,
      status: 'removed',
      bytesDelta: null,
      indexBytesDelta: null,
    });
  return { status: 'compared', changes };
}
export function databaseInterval(previous, current) {
  if (!previous) return { status: 'baseline' };
  const milliseconds =
    new Date(current.sampledAt) - new Date(previous.sampledAt);
  if (
    String(previous.statsReset) !== String(current.statsReset) ||
    counters.some((key) => current[key] < previous[key])
  )
    return { status: 'reset' };
  if (!(milliseconds > 0)) return { status: 'invalid-time' };
  const delta = Object.fromEntries(
    counters.map((key) => [key, current[key] - previous[key]]),
  );
  const blocks = delta.blocksHit + delta.blocksRead;
  return {
    status: 'ok',
    milliseconds,
    delta,
    transactionsPerSecond:
      ((delta.commits + delta.rollbacks) * 1000) / milliseconds,
    bufferHitRatio: blocks ? delta.blocksHit / blocks : null,
  };
}

export function databaseSignals(sample, interval) {
  const signals = [];
  if (
    !sample.fullVisibility ||
    !sample.activitiesTracked ||
    !sample.countsTracked
  )
    signals.push('incomplete-visibility');
  if (sample.serverClientConnections / sample.serverMaxConnections >= 0.8)
    signals.push('connection-pressure');
  if (sample.lockWaiters > 0) signals.push('lock-contention');
  if (sample.ioWaiters > 0) signals.push('io-waits');
  if (sample.slowActiveQueries > 0) signals.push('slow-active-queries');
  if (sample.oldestTransactionMs >= 30_000) signals.push('long-transaction');
  if (sample.idleInTransaction > 0) signals.push('idle-transaction');
  if (interval.delta?.deadlocks > 0) signals.push('deadlocks-in-interval');
  if (interval.delta?.tempBytes > 16 * 1024 * 1024)
    signals.push('temporary-file-growth');
  if (interval.status === 'reset') signals.push('statistics-reset');
  return signals;
}

/** One dedicated read-only connection. No auto migrations, resets or extension creation. */
export class DatabaseMonitor {
  constructor(client) {
    this.client = client;
  }
  async sample() {
    const started = performance.now();
    const current = (await this.client.query(databaseSampleSql)).rows[0];
    if (!current) throw new Error('Database statistics unavailable');
    const interval = databaseInterval(this.previous, current);
    this.previous = current;
    return {
      database: current,
      interval,
      signals: databaseSignals(current, interval),
      collectorRoundTripMs: performance.now() - started,
    };
  }
  async statements() {
    // Discover extension schema, not search_path; Supabase commonly uses extensions.
    const extension = (
      await this.client.query(`SELECT n.nspname FROM pg_extension e
      JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_stat_statements'`)
    ).rows[0];
    if (!extension)
      return { status: 'unavailable', reason: 'extension-not-installed' };
    const schema = '"' + extension.nspname.replaceAll('"', '""') + '"';
    try {
      const rows = (
        await this.client.query(`SELECT queryid::text AS fingerprint,
        calls::float8 AS calls,total_exec_time AS "totalExecutionMs",
        mean_exec_time AS "meanExecutionMs",max_exec_time AS "maxExecutionMs",
        shared_blks_hit::float8 AS "blocksHit",shared_blks_read::float8 AS "blocksRead",
        temp_blks_written::float8 AS "tempBlocksWritten"
        FROM ${schema}.pg_stat_statements
        WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND queryid IS NOT NULL ORDER BY total_exec_time DESC LIMIT 10`)
      ).rows;
      return {
        status: 'available',
        scope: 'cumulative-since-provider-reset; not p95/p99',
        rows,
      };
    } catch (error) {
      if (['42501', '55000', '42P01', '42703'].includes(error.code))
        return {
          status: 'unavailable',
          reason: 'provider-configuration-or-permissions',
        };
      throw error;
    }
  }
  async relations() {
    try {
      const rows = (await this.client.query(relationSizeSql)).rows;
      // An incomplete catalog must never be presented as zero growth or removals.
      if (rows.length > 600) {
        this.previousRelations = undefined;
        return { status: 'incomplete', reason: 'relation-limit', limit: 600 };
      }
      const growth = relationGrowth(this.previousRelations, rows);
      this.previousRelations = rows;
      return {
        status: 'available',
        scope: 'public ordinary tables and indexes; physical allocated bytes',
        sampledAt: new Date().toISOString(),
        rows,
        growth,
      };
    } catch (error) {
      this.previousRelations = undefined;
      if (error.code === '42501')
        return { status: 'unavailable', reason: 'permissions' };
      throw error;
    }
  }
}

export function monitorOptions(env) {
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  if (!env.MONITOR_DATABASE_URL)
    throw new Error('MONITOR_DATABASE_URL is required');
  const url = new URL(env.MONITOR_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid monitor URL protocol');
  return {
    connectionString: env.MONITOR_DATABASE_URL,
    intervalMs: integer('DB_MONITOR_INTERVAL_MS', 5000, 1000, 60_000),
    samples: integer('DB_MONITOR_SAMPLES', 12, 1, 720),
  };
}

export async function runMonitor(env = process.env) {
  const options = monitorOptions(env);
  const client = new pg.Client({
    connectionString: options.connectionString,
    application_name: 'paserve-db-monitor',
    connectionTimeoutMillis: 3000,
    statement_timeout: 2000,
    query_timeout: 3000,
    options: '-c default_transaction_read_only=on',
  });
  // Consume idle socket errors; the next bounded sample will fail and close.
  client.on('error', () => {});
  try {
    await client.connect();
    const monitor = new DatabaseMonitor(client);
    for (let index = 0; index < options.samples; index++) {
      if (index) await delay(options.intervalMs);
      const sample = await monitor.sample();
      if (index === 0 || index === options.samples - 1) {
        sample.statements = await monitor.statements();
        sample.relations = await monitor.relations();
      }
      process.stdout.write(
        JSON.stringify({ type: 'database-monitor', ...sample }) + '\n',
      );
    }
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runMonitor();
  } catch {
    console.error(
      'Database monitor failed. Check configuration, connectivity and monitoring permissions.',
    );
    process.exitCode = 1;
  }
}
