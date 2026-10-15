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
    `CREATE TEMP TABLE orders(id text PRIMARY KEY,"shopId" text,status text,"paymentStatus" text,"preparationStatus" text,"queuedAt" timestamp(3),"preparationStartedAt" timestamp(3),"preparationStartedBy" text,"preparationReadyAt" timestamp(3),"preparationReadyBy" text,"completedAt" timestamp(3),"completedBy" text)`,
  );
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20261015230000_order_completed_events/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    sql
      .replaceAll('public.orders', 'pg_temp.orders')
      .replaceAll(
        'public.broadcast_order_completed',
        'pg_temp.broadcast_order_completed',
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
  const create = (id) =>
    client.query(
      `INSERT INTO pg_temp.orders VALUES($1,$2,'CONFIRMED','PAID','READY',now(),now()+interval '1 second','start',now()+interval '2 seconds','ready',NULL,NULL)`,
      [id, shopId],
    );
  const complete = (id) =>
    client.query(
      `UPDATE pg_temp.orders SET "preparationStatus"='COMPLETED',"completedAt"="preparationReadyAt"+interval '1 second',"completedBy"='completed' WHERE id=$1`,
      [id],
    );
  await create(orderId);
  await client.query('SAVEPOINT completion');
  await complete(orderId);
  assert.equal(await count(), 3);
  await client.query('ROLLBACK TO SAVEPOINT completion');
  assert.equal(await count(), 0);
  await complete(orderId);
  await complete(orderId);
  assert.equal(await count(), 3, 'Retry does not repeat completion');
  for (const [label, change] of [
    ['pending', `status='PENDING_CONFIRMATION'`],
    ['unpaid', `"paymentStatus"='UNPAID'`],
    ['skip-ready', `"preparationStatus"='PREPARING'`],
    ['missing-queue', `"queuedAt"=NULL`],
    ['missing-start', `"preparationStartedAt"=NULL`],
    ['missing-start-actor', `"preparationStartedBy"=NULL`],
    ['missing-ready', `"preparationReadyAt"=NULL`],
    ['missing-ready-actor', `"preparationReadyBy"=NULL`],
    ['invalid-start', `"preparationStartedAt"="queuedAt"-interval '1 second'`],
    [
      'invalid-ready',
      `"preparationReadyAt"="preparationStartedAt"-interval '1 second'`,
    ],
  ]) {
    await create(label);
    await client.query(`UPDATE pg_temp.orders SET ${change} WHERE id=$1`, [
      label,
    ]);
    await complete(label);
  }
  for (const [label, change] of [
    ['missing-completion', `"completedAt"=NULL,"completedBy"='actor'`],
    [
      'missing-completer',
      `"completedAt"="preparationReadyAt","completedBy"=NULL`,
    ],
    [
      'early-completion',
      `"completedAt"="preparationReadyAt"-interval '1 second',"completedBy"='actor'`,
    ],
  ]) {
    await create(label);
    await client.query(
      `UPDATE pg_temp.orders SET "preparationStatus"='COMPLETED',${change} WHERE id=$1`,
      [label],
    );
  }
  assert.equal(await count(), 3, 'Invalid completion is not broadcast');
  for (const row of (
    await client.query(
      `SELECT topic,event,private,payload FROM realtime.messages WHERE topic=ANY($1::text[])`,
      [topics],
    )
  ).rows) {
    assert.equal(row.event, 'order_completed');
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
    `CREATE POLICY completed_test_permissive ON realtime.messages FOR ALL TO authenticated USING(true) WITH CHECK(true)`,
  );
  await client.query('SET LOCAL ROLE authenticated');
  assert.equal(await count(), 0);
  await client.query('RESET ROLE');
  for (const topic of topics) {
    await client.query('SAVEPOINT publish');
    await client.query('SET LOCAL ROLE authenticated');
    await assert.rejects(
      client.query(
        `INSERT INTO realtime.messages(topic,event,payload,private,extension) VALUES($1,'order_completed','{}',true,'broadcast')`,
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
    'Passed: READY -> COMPLETED gating, saved timeline/actor/payment requirements, retry suppression, transactional rollback, three private minimal topics, and browser receive/publish denial. All fixtures rolled back.',
  );
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}
