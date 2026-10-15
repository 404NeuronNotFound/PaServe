import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Exact migration on temporary orders, with all messages/grants/policies rolled back.
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
    `CREATE TEMP TABLE orders(id text PRIMARY KEY,"shopId" text,status text,"paymentStatus" text,"preparationStatus" text,"queuedAt" timestamp(3),"preparationStartedAt" timestamp(3),"preparationStartedBy" text,"preparationReadyAt" timestamp(3),"preparationReadyBy" text)`,
  );
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20261015220000_order_ready_events/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    sql
      .replaceAll('public.orders', 'pg_temp.orders')
      .replaceAll(
        'public.broadcast_order_ready',
        'pg_temp.broadcast_order_ready',
      ),
  );
  for (const [name, migration] of [
    ['confirmed_order_backend_only', '20261015200000_order_confirmed_events'],
    ['preparing_order_backend_only', '20261015210000_order_preparing_events'],
  ]) {
    const installed = await client.query(
      `SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname=$1`,
      [name],
    );
    if (!installed.rowCount) {
      const prerequisite = await readFile(
        new URL(
          `../prisma/migrations/${migration}/migration.sql`,
          import.meta.url,
        ),
        'utf8',
      );
      await client.query(
        prerequisite.slice(prerequisite.indexOf('CREATE POLICY')),
      );
    }
  }
  await client.query(
    `INSERT INTO pg_temp.orders VALUES($1,$2,'CONFIRMED','PAID','PREPARING',now(),now()+interval '1 second','fixture-start',NULL,NULL)`,
    [orderId, shopId],
  );
  assert.equal(await count(), 0);
  const ready = () =>
    client.query(
      `UPDATE pg_temp.orders SET "preparationStatus"='READY',"preparationReadyAt"="preparationStartedAt"+interval '1 second',"preparationReadyBy"='fixture-ready' WHERE id=$1`,
      [orderId],
    );
  await client.query('SAVEPOINT readiness');
  await ready();
  assert.equal(await count(), 3);
  await client.query('ROLLBACK TO SAVEPOINT readiness');
  assert.equal(await count(), 0);
  await ready();
  await ready();
  assert.equal(await count(), 3, 'Retry does not repeat readiness');
  await client.query(
    `UPDATE pg_temp.orders SET "preparationStatus"='COMPLETED' WHERE id=$1`,
    [orderId],
  );
  assert.equal(await count(), 3, 'Fulfillment does not repeat readiness');
  for (const [
    label,
    status,
    payment,
    source,
    startedActor,
    readyActor,
    interval,
  ] of [
    [
      'pending',
      'PENDING_CONFIRMATION',
      'UNPAID',
      'PREPARING',
      'actor',
      'actor',
      '1 second',
    ],
    [
      'unpaid',
      'CONFIRMED',
      'UNPAID',
      'PREPARING',
      'actor',
      'actor',
      '1 second',
    ],
    ['skip-queue', 'CONFIRMED', 'PAID', 'QUEUED', 'actor', 'actor', '1 second'],
    [
      'no-start-actor',
      'CONFIRMED',
      'PAID',
      'PREPARING',
      null,
      'actor',
      '1 second',
    ],
    [
      'no-ready-actor',
      'CONFIRMED',
      'PAID',
      'PREPARING',
      'actor',
      null,
      '1 second',
    ],
    [
      'ready-too-early',
      'CONFIRMED',
      'PAID',
      'PREPARING',
      'actor',
      'actor',
      '-1 second',
    ],
  ]) {
    await client.query(
      `INSERT INTO pg_temp.orders VALUES($1,$2,$3,$4,$5,now(),now()+interval '1 second',$6,NULL,NULL)`,
      [label, shopId, status, payment, source, startedActor],
    );
    await client.query(
      `UPDATE pg_temp.orders SET "preparationStatus"='READY',"preparationReadyAt"="preparationStartedAt"+$2::interval,"preparationReadyBy"=$3 WHERE id=$1`,
      [label, interval, readyActor],
    );
  }
  assert.equal(await count(), 3, 'Invalid readiness is not broadcast');
  for (const row of (
    await client.query(
      `SELECT topic,event,private,payload FROM realtime.messages WHERE topic=ANY($1::text[])`,
      [topics],
    )
  ).rows) {
    assert.equal(row.event, 'order_ready');
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
    `CREATE POLICY ready_test_permissive ON realtime.messages FOR ALL TO authenticated USING(true) WITH CHECK(true)`,
  );
  await client.query('SET LOCAL ROLE authenticated');
  assert.equal(await count(), 0);
  await client.query('RESET ROLE');
  for (const topic of topics) {
    await client.query('SAVEPOINT publish');
    await client.query('SET LOCAL ROLE authenticated');
    await assert.rejects(
      client.query(
        `INSERT INTO realtime.messages(topic,event,payload,private,extension) VALUES($1,'order_ready','{}',true,'broadcast')`,
        [topic],
      ),
      (error) => error.code === '42501',
    );
    await client.query('ROLLBACK TO SAVEPOINT publish');
    await client.query('RESET ROLE');
  }
  await client.query('ROLLBACK');
  assert.equal(await count(), 0);
  console.log(
    'Passed: PREPARING -> READY gating, saved timeline/actor/payment requirements, retry/fulfillment suppression, transactional rollback, three private minimal topics, and browser receive/publish denial. All fixtures rolled back.',
  );
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}
