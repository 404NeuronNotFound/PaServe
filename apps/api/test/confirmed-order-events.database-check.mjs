import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Apply the exact migration to session-local orders; all policy/message changes
// remain in one transaction and roll back. Public business rows are untouched.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const shopId = randomUUID(),
  orderId = randomUUID();
const topics = [
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
  await client.query(`CREATE TEMP TABLE orders (id text PRIMARY KEY, "shopId" text, status text, "paymentStatus" text,
    "decidedAt" timestamp(3), "paidAt" timestamp(3), "qrTokenRevokedAt" timestamp(3), "preparationStatus" text)`);
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20261015200000_order_confirmed_events/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const consumedAt = new Date();
  await client.query(
    `INSERT INTO pg_temp.orders VALUES ('legacy-paid',$1,'CONFIRMED','PAID',$2,$2,$2,'QUEUED'), ('legacy-revoked',$1,'PENDING_CONFIRMATION','UNPAID',NULL,NULL,$2,NULL)`,
    [shopId, consumedAt],
  );
  await client.query(
    migration
      .replaceAll('public.orders', 'pg_temp.orders')
      .replaceAll(
        'public.broadcast_order_confirmed',
        'pg_temp.broadcast_order_confirmed',
      ),
  );
  const legacy = (
    await client.query(
      `SELECT id, "receiptAccessRevokedAt" FROM pg_temp.orders ORDER BY id`,
    )
  ).rows;
  assert.equal(legacy[0].receiptAccessRevokedAt, null);
  assert.ok(legacy[1].receiptAccessRevokedAt instanceof Date);
  await client.query(
    `INSERT INTO pg_temp.orders (id,"shopId",status,"paymentStatus") VALUES ($1,$2,'PENDING_CONFIRMATION','UNPAID')`,
    [orderId, shopId],
  );
  assert.equal(await count(), 0);
  await client.query('SAVEPOINT confirmation');
  const confirm = () =>
    client.query(
      `UPDATE pg_temp.orders SET status='CONFIRMED', "paymentStatus"='PAID', "decidedAt"=now(), "paidAt"=now(), "preparationStatus"='QUEUED' WHERE id=$1`,
      [orderId],
    );
  await confirm();
  assert.equal(await count(), 2);
  await client.query('ROLLBACK TO SAVEPOINT confirmation');
  assert.equal(await count(), 0);
  await client.query(
    `UPDATE pg_temp.orders SET status='CONFIRMED', "decidedAt"=now() WHERE id=$1`,
    [orderId],
  );
  assert.equal(await count(), 0, 'Unpaid confirmation must not publish');
  await confirm();
  assert.equal(await count(), 2);
  await confirm();
  assert.equal(
    await count(),
    2,
    'Retries do not announce another confirmation',
  );
  await client.query(
    `UPDATE pg_temp.orders SET "preparationStatus"='PREPARING' WHERE id=$1`,
    [orderId],
  );
  assert.equal(
    await count(),
    2,
    'Later preparation does not announce confirmation again',
  );
  const rows = (
    await client.query(
      `SELECT topic,event,private,payload FROM realtime.messages WHERE topic=ANY($1::text[])`,
      [topics],
    )
  ).rows;
  for (const row of rows) {
    assert.equal(row.event, 'order_confirmed');
    assert.equal(row.private, true);
    assert.deepEqual(Object.keys(row.payload).sort(), [
      'id',
      'orderId',
      'shopId',
    ]);
    assert.equal(row.payload.orderId, orderId);
    assert.equal(row.payload.shopId, shopId);
  }
  await client.query('GRANT USAGE ON SCHEMA realtime TO authenticated');
  await client.query(
    'GRANT SELECT, INSERT ON realtime.messages TO authenticated',
  );
  await client.query(
    `CREATE POLICY confirmation_test_permissive ON realtime.messages FOR ALL TO authenticated USING(true) WITH CHECK(true)`,
  );
  await client.query('SET LOCAL ROLE authenticated');
  assert.equal(await count(), 0);
  await client.query('RESET ROLE');
  for (const topic of topics) {
    await client.query('SAVEPOINT publish');
    await client.query('SET LOCAL ROLE authenticated');
    await assert.rejects(
      client.query(
        `INSERT INTO realtime.messages(topic,event,payload,private,extension) VALUES($1,'order_confirmed','{}',true,'broadcast')`,
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
    'Passed: transactional confirmation events, payment gating, rollback/retry/later-state exclusion, staff/customer topic and payload isolation, independent receipt revocation backfill, and browser receive/publish denial. All fixtures rolled back.',
  );
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}
