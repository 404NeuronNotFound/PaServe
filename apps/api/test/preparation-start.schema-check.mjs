import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const { rows: columns } =
    await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
    AND column_name IN ('preparationStartedAt', 'preparationStartedBy', 'preparationReadyAt', 'preparationReadyBy')`);
  assert.equal(columns.length, 4);
  const { rows: constraints } =
    await client.query(`SELECT conname, convalidated FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname IN ('orders_preparation_check', 'orders_preparation_start_check', 'orders_preparation_ready_check')`);
  assert.equal(constraints.length, 3);
  assert.ok(constraints.every((item) => item.convalidated));
  const { rows: triggers } =
    await client.query(`SELECT tgname, tgenabled FROM pg_trigger
    WHERE tgrelid = 'public.orders'::regclass AND tgname IN ('orders_queue_guard', 'orders_preparation_start_guard', 'orders_preparation_ready_guard')`);
  assert.equal(triggers.length, 3);
  assert.ok(triggers.every((item) => item.tgenabled === 'O'));
  const {
    rows: [security],
  } = await client.query(`SELECT relrowsecurity,
    has_table_privilege('anon', 'public.orders', 'SELECT') AS anon_read,
    has_table_privilege('authenticated', 'public.orders', 'SELECT') AS browser_read
    FROM pg_class WHERE oid = 'public.orders'::regclass`);
  assert.equal(security.relrowsecurity, true);
  assert.equal(security.anon_read, false);
  assert.equal(security.browser_read, false);
  await client.query('COMMIT');
  console.log(
    'Passed: deployed preparation start/readiness fields, validated constraints, enabled guards, and preserved orders RLS/browser read restrictions. Read-only verification.',
  );
} finally {
  await client.end();
}
