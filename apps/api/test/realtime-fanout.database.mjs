import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

export function validateFanoutDatabase(databaseUrl, projectRef) {
  assert.match(projectRef ?? '', /^[a-z0-9]{20}$/);
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('Invalid disposable database URL.');
  }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.pathname, '/postgres');
  assert.equal(
    url.port || '5432',
    '5432',
    'Temporary fixtures require a session connection, not transaction pooling.',
  );
  assert.ok(
    (url.hostname === `db.${projectRef}.supabase.co` &&
      url.username === 'postgres') ||
      (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
        url.username === `postgres.${projectRef}`),
    'Database must belong to the expected disposable Supabase project.',
  );
  assert.ok(!url.searchParams.has('options') && !url.searchParams.has('host'));
  return url.href;
}

export async function openFanoutDatabase(databaseUrl, projectRef, tenants) {
  const client = new pg.Client({
    connectionString: validateFanoutDatabase(databaseUrl, projectRef),
    connectionTimeoutMillis: 8000,
    statement_timeout: 8000,
    query_timeout: 10000,
    application_name: 'paserve-isolated-fanout',
  });
  const stats = {
    commits: 0,
    rollbacks: 0,
    transitions: 0,
    scoped: true,
    temporaryObjectsOnly: true,
  };
  try {
    await client.connect();
    await client.query(
      `CREATE TEMP TABLE orders(id text PRIMARY KEY,"shopId" text,status text,"paymentStatus" text,"preparationStatus" text,"queuedAt" timestamp(3),"preparationStartedAt" timestamp(3),"preparationStartedBy" text,"preparationReadyAt" timestamp(3),"preparationReadyBy" text,"completedAt" timestamp(3),"completedBy" text)`,
    );
    for (const [stamp, event] of [
      ['20261015210000', 'preparing'],
      ['20261015220000', 'ready'],
      ['20261015230000', 'completed'],
    ]) {
      let sql = await readFile(
        new URL(
          `../prisma/migrations/${stamp}_order_${event}_events/migration.sql`,
          import.meta.url,
        ),
        'utf8',
      );
      if (event === 'preparing')
        sql = sql.slice(0, sql.indexOf('-- Existing confirmation'));
      sql = sql
        .replaceAll('public.orders', 'pg_temp.orders')
        .replaceAll(
          `public.broadcast_order_${event}`,
          `pg_temp.broadcast_order_${event}`,
        );
      // Fail before execution if a migration changes beyond the approved temp-only shape.
      assert.ok(!/CREATE POLICY|ALTER TABLE|public\./i.test(sql));
      await client.query(sql);
    }
    for (const t of tenants)
      await client.query(
        `INSERT INTO pg_temp.orders VALUES($1,$2,'CONFIRMED','PAID','QUEUED',now(),NULL,NULL,NULL,NULL,NULL,NULL)`,
        [t.orderId, t.shopId],
      );
  } catch (error) {
    await client.end();
    throw error;
  }
  const update = async (event, rollback = false) => {
    const states = {
      order_preparing: [
        'QUEUED',
        'PREPARING',
        `"preparationStartedAt"="queuedAt"+interval '1 second',"preparationStartedBy"='fixture-start'`,
      ],
      order_ready: [
        'PREPARING',
        'READY',
        `"preparationReadyAt"="preparationStartedAt"+interval '1 second',"preparationReadyBy"='fixture-ready'`,
      ],
      order_completed: [
        'READY',
        'COMPLETED',
        `"completedAt"="preparationReadyAt"+interval '1 second',"completedBy"='fixture-complete'`,
      ],
    };
    const [before, after, fields] = states[event];
    await client.query('BEGIN');
    try {
      // One committed burst updates all three tenants; each real trigger sends
      // staff, kitchen and exact-customer broadcasts atomically with the writes.
      const result = await client.query(
        `UPDATE pg_temp.orders SET "preparationStatus"=$1,${fields} WHERE "preparationStatus"=$2 AND id=ANY($3::text[]) AND "shopId"=ANY($4::text[]) RETURNING id,"shopId"`,
        [
          after,
          before,
          tenants.map((t) => t.orderId),
          tenants.map((t) => t.shopId),
        ],
      );
      assert.equal(result.rowCount, 3);
      assert.ok(
        result.rows.every((row) =>
          tenants.some((t) => t.shopId === row.shopId && t.orderId === row.id),
        ),
      );
      await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
      if (rollback) stats.rollbacks++;
      else {
        stats.commits++;
        stats.transitions += result.rowCount;
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };
  return {
    stats,
    transition: update,
    async states() {
      return (
        await client.query(
          'SELECT "preparationStatus" state FROM pg_temp.orders',
        )
      ).rows.map((r) => r.state);
    },
    async close() {
      try {
        const objects = (
          await client.query(
            `SELECT count(*)::int n FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relname='orders'`,
          )
        ).rows[0].n;
        await client.query('DROP TABLE pg_temp.orders');
        for (const event of ['preparing', 'ready', 'completed'])
          await client.query(
            `DROP FUNCTION pg_temp.broadcast_order_${event}()`,
          );
        const remains = (
          await client.query(
            `SELECT count(*)::int n FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relname='orders'`,
          )
        ).rows[0].n;
        return objects === 1 && remains === 0;
      } finally {
        await client.end();
      }
    },
  };
}
