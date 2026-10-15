import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const shopId = randomUUID(),
  orderId = randomUUID();
const topics = [
  `staff:preparation:${shopId}`,
  `staff:confirmed:${shopId}`,
  `customer:confirmed:${shopId}:${orderId}`,
];
const count = async () =>
  Number(
    (
      await client.query(
        `SELECT count(*) AS n FROM realtime.messages WHERE topic=ANY($1::text[])`,
        [topics],
      )
    ).rows[0].n,
  );
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(
    `CREATE TEMP TABLE orders(id text PRIMARY KEY,"shopId" text,status text,"paymentStatus" text,"preparationStatus" text,"queuedAt" timestamp(3),"preparationStartedAt" timestamp(3),"preparationStartedBy" text)`,
  );
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20261015210000_order_preparing_events/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    sql
      .replaceAll('public.orders', 'pg_temp.orders')
      .replaceAll(
        'public.broadcast_order_preparing',
        'pg_temp.broadcast_order_preparing',
      ),
  );
  await client.query(
    `INSERT INTO pg_temp.orders VALUES($1,$2,'CONFIRMED','PAID','QUEUED',now(),NULL,NULL)`,
    [orderId, shopId],
  );
  assert.equal(await count(), 0);
  const start = () =>
    client.query(
      `UPDATE pg_temp.orders SET "preparationStatus"='PREPARING',"preparationStartedAt"="queuedAt" + interval '1 second',"preparationStartedBy"='fixture-actor' WHERE id=$1`,
      [orderId],
    );
  await client.query('SAVEPOINT preparing');
  await start();
  assert.equal(await count(), 3);
  await client.query('ROLLBACK TO SAVEPOINT preparing');
  assert.equal(await count(), 0);
  await start();
  await start();
  assert.equal(await count(), 3, 'Retry emits no second preparation start');
  await client.query(
    `UPDATE pg_temp.orders SET "preparationStatus"='READY' WHERE id=$1`,
    [orderId],
  );
  await client.query(
    `UPDATE pg_temp.orders SET "preparationStatus"='COMPLETED' WHERE id=$1`,
    [orderId],
  );
  assert.equal(
    await count(),
    3,
    'Later transitions do not repeat the start event',
  );
  for (const [label, status, payment, source, validTimeline, actor] of [
    ['pending', 'PENDING_CONFIRMATION', 'UNPAID', 'QUEUED', true, 'actor'],
    ['unpaid', 'CONFIRMED', 'UNPAID', 'QUEUED', true, 'actor'],
    ['wrong-source', 'CONFIRMED', 'PAID', 'READY', true, 'actor'],
    ['bad-time', 'CONFIRMED', 'PAID', 'QUEUED', false, 'actor'],
    ['missing-actor', 'CONFIRMED', 'PAID', 'QUEUED', true, null],
  ]) {
    await client.query(
      `INSERT INTO pg_temp.orders VALUES($1,$2,$3,$4,$5,now(),NULL,NULL)`,
      [label, shopId, status, payment, source],
    );
    await client.query(
      `UPDATE pg_temp.orders SET "preparationStatus"='PREPARING',"preparationStartedAt"="queuedAt" + $2::interval,"preparationStartedBy"=$3 WHERE id=$1`,
      [label, validTimeline ? '1 second' : '-1 second', actor],
    );
  }
  assert.equal(
    await count(),
    3,
    'Ineligible or inconsistent changes do not publish',
  );
  const messages = (
    await client.query(
      `SELECT topic,event,private,payload FROM realtime.messages WHERE topic=ANY($1::text[])`,
      [topics],
    )
  ).rows;
  for (const row of messages) {
    assert.equal(row.event, 'order_preparing');
    assert.equal(row.private, true);
    assert.deepEqual(Object.keys(row.payload).sort(), [
      'id',
      'orderId',
      'shopId',
    ]);
    assert.equal(row.payload.shopId, shopId);
    assert.equal(row.payload.orderId, orderId);
  }
  await client.query('GRANT USAGE ON SCHEMA realtime TO authenticated');
  await client.query(
    'GRANT SELECT, INSERT ON realtime.messages TO authenticated',
  );
  await client.query(
    `CREATE POLICY preparing_test_permissive ON realtime.messages FOR ALL TO authenticated USING(true) WITH CHECK(true)`,
  );
  await client.query('SET LOCAL ROLE authenticated');
  assert.equal(
    Number(
      (
        await client.query(
          'SELECT count(*) AS n FROM realtime.messages WHERE topic=$1',
          [topics[0]],
        )
      ).rows[0].n,
    ),
    0,
  );
  await client.query('RESET ROLE');
  await client.query('SAVEPOINT publish');
  await client.query('SET LOCAL ROLE authenticated');
  await assert.rejects(
    client.query(
      `INSERT INTO realtime.messages(topic,event,payload,private,extension) VALUES($1,'order_preparing','{}',true,'broadcast')`,
      [topics[0]],
    ),
    (error) => error.code === '42501',
  );
  await client.query('ROLLBACK TO SAVEPOINT publish');
  await client.query('RESET ROLE');
  await client.query('ROLLBACK');
  assert.equal(await count(), 0);
  console.log(
    'Passed: exact QUEUED -> PREPARING eligibility, transactional rollback, retry/later-state suppression, three private scoped topics, minimal payloads, and browser dashboard read/publish denial. All fixtures rolled back.',
  );
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}
