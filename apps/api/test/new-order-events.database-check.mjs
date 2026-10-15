import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Rollback-only: run the migration against a temporary order table. Real
// realtime.send writes remain uncommitted, so no fixture broadcast escapes.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const shopA = randomUUID();
const shopB = randomUUID();
const count = async () =>
  Number(
    (
      await client.query(
        `SELECT count(*) AS count FROM realtime.messages WHERE topic = ANY($1::text[])`,
        [
          [
            `staff:new-order:${shopA}:cashier`,
            `staff:new-order:${shopA}:kitchen`,
            `staff:new-order:${shopB}:cashier`,
          ],
        ],
      )
    ).rows[0].count,
  );
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(`CREATE TEMP TABLE orders (
    id text PRIMARY KEY, "shopId" text, status text, "paymentStatus" text,
    "preparationStatus" text, "queuedAt" timestamptz
  )`);
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20261015190000_new_order_broadcast/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  // The function/table are session-local. The restrictive policy is exercised
  // on the actual realtime table and rolls back with the entire transaction.
  await client.query(
    migration
      .replaceAll(
        'public.broadcast_new_order_workflow',
        'pg_temp.broadcast_new_order_workflow',
      )
      .replaceAll('ON public.orders', 'ON pg_temp.orders'),
  );
  await client.query(
    `INSERT INTO pg_temp.orders VALUES ('a', $1, 'PENDING_CONFIRMATION', 'UNPAID', NULL, NULL)`,
    [shopA],
  );
  assert.equal(await count(), 1, 'Pending creation emits one cashier event');
  await client.query(
    `UPDATE pg_temp.orders SET status = status WHERE id = 'a'`,
  );
  assert.equal(await count(), 1, 'No repeated event from unchanged updates');
  await client.query('SAVEPOINT payment');
  await client.query(
    `UPDATE pg_temp.orders SET status='CONFIRMED', "paymentStatus"='PAID', "preparationStatus"='QUEUED', "queuedAt"=now() WHERE id='a'`,
  );
  assert.equal(await count(), 2, 'Paid/queued entry emits a kitchen event');
  await client.query('ROLLBACK TO SAVEPOINT payment');
  assert.equal(await count(), 1, 'Failed payment rolls back its event');
  await client.query(
    `UPDATE pg_temp.orders SET status='CONFIRMED', "paymentStatus"='PAID', "preparationStatus"='QUEUED', "queuedAt"=now() WHERE id='a'`,
  );
  await client.query(
    `UPDATE pg_temp.orders SET "queuedAt"="queuedAt" WHERE id='a'`,
  );
  assert.equal(
    await count(),
    2,
    'Payment retry produces no second entry event',
  );
  await client.query(
    `UPDATE pg_temp.orders SET "preparationStatus"='PREPARING' WHERE id='a'`,
  );
  await client.query(
    `UPDATE pg_temp.orders SET "preparationStatus"='READY' WHERE id='a'`,
  );
  await client.query(
    `UPDATE pg_temp.orders SET "preparationStatus"='COMPLETED' WHERE id='a'`,
  );
  await client.query(
    `INSERT INTO pg_temp.orders VALUES ('rejected', $1, 'REJECTED', 'UNPAID', NULL, NULL), ('unpaid', $1, 'CONFIRMED', 'UNPAID', 'QUEUED', now())`,
    [shopA],
  );
  assert.equal(
    await count(),
    2,
    'Later transitions and ineligible orders do not emit New Order',
  );
  await client.query(
    `INSERT INTO pg_temp.orders VALUES ('b', $1, 'PENDING_CONFIRMATION', 'UNPAID', NULL, NULL)`,
    [shopB],
  );
  assert.equal(await count(), 3);
  const messages = await client.query(
    `SELECT topic, private, event, payload FROM realtime.messages WHERE topic = ANY($1::text[])`,
    [
      [
        `staff:new-order:${shopA}:cashier`,
        `staff:new-order:${shopA}:kitchen`,
        `staff:new-order:${shopB}:cashier`,
      ],
    ],
  );
  for (const message of messages.rows) {
    assert.equal(message.private, true);
    assert.equal(message.event, 'new_order');
    assert.deepEqual(Object.keys(message.payload).sort(), [
      'id',
      'shopId',
      'workflow',
    ]);
    assert.equal(typeof message.payload.id, 'string'); // Supabase adds a message ID.
    assert.equal(
      message.topic,
      `staff:new-order:${message.payload.shopId}:${message.payload.workflow}`,
    );
  }
  const policy = await client.query(
    `SELECT permissive, roles::text[] AS roles FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='staff_new_order_backend_only'`,
  );
  assert.equal(policy.rows[0].permissive, 'RESTRICTIVE');
  assert.deepEqual(policy.rows[0].roles.sort(), ['anon', 'authenticated']);
  // Prove a permissive policy cannot open this namespace. These temporary
  // grants/policies are rolled back; they do not change deployed privileges.
  await client.query(`GRANT USAGE ON SCHEMA realtime TO authenticated`);
  await client.query(
    `GRANT SELECT, INSERT ON realtime.messages TO authenticated`,
  );
  await client.query(
    `CREATE POLICY staff_new_order_test_permissive ON realtime.messages FOR ALL TO authenticated USING (true) WITH CHECK (true)`,
  );
  await client.query('SET LOCAL ROLE authenticated');
  assert.equal(
    await count(),
    0,
    'Restrictive policy prevents browser reads despite permissive grants',
  );
  await client.query('RESET ROLE');
  await client.query('SAVEPOINT browser_publish');
  await client.query('SET LOCAL ROLE authenticated');
  await assert.rejects(
    client.query(
      `INSERT INTO realtime.messages (topic, event, payload, private, extension)
    VALUES ($1, 'new_order', '{}'::jsonb, true, 'broadcast')`,
      [`staff:new-order:${shopA}:kitchen`],
    ),
    (error) => error.code === '42501',
  );
  await client.query('ROLLBACK TO SAVEPOINT browser_publish');
  await client.query('RESET ROLE');
  await client.query('ROLLBACK');
  assert.equal(await count(), 0, 'All fixture messages rolled back');
  console.log(
    'Passed: workflow predicates, cashier/kitchen topics, private minimal payloads, unchanged-write retries, payment rollback, later-state exclusion, restrictive browser policy, and full fixture rollback.',
  );
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}
