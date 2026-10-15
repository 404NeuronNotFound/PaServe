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
    AND column_name IN ('preparationStartedAt', 'preparationStartedBy', 'preparationReadyAt', 'preparationReadyBy', 'completedAt', 'completedBy')`);
  assert.equal(columns.length, 6);
  const { rows: constraints } =
    await client.query(`SELECT conname, convalidated FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname IN ('orders_preparation_check', 'orders_preparation_start_check', 'orders_preparation_ready_check', 'orders_completion_check')`);
  assert.equal(constraints.length, 4);
  assert.ok(constraints.every((item) => item.convalidated));
  const { rows: triggers } =
    await client.query(`SELECT tgname, tgenabled FROM pg_trigger
    WHERE tgrelid = 'public.orders'::regclass AND tgname IN ('orders_queue_guard', 'orders_preparation_start_guard', 'orders_preparation_ready_guard', 'orders_completion_guard')`);
  assert.equal(triggers.length, 4);
  assert.ok(triggers.every((item) => item.tgenabled === 'O'));
  const {
    rows: [guard],
  } = await client.query(
    `SELECT pg_get_functiondef('public.protect_order_queue()'::regprocedure) AS definition`,
  );
  assert.ok(guard.definition.includes('Preparation must enter QUEUED first'));
  const index = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'orders' AND indexname = 'orders_shopId_preparationStatus_completedAt_id_idx'`,
  );
  assert.equal(index.rowCount, 1);
  const {
    rows: [security],
  } = await client.query(`SELECT relrowsecurity,
    has_table_privilege('anon', 'public.orders', 'SELECT') AS anon_read,
    has_table_privilege('authenticated', 'public.orders', 'SELECT') AS browser_read
    FROM pg_class WHERE oid = 'public.orders'::regclass`);
  assert.equal(security.relrowsecurity, true);
  assert.equal(security.anon_read, false);
  assert.equal(security.browser_read, false);
  const {
    rows: [timeline],
  } =
    await client.query(`SELECT count(*)::int AS invalid_count FROM public.orders
    WHERE "preparationStatus" IS NOT NULL AND (
      status <> 'CONFIRMED' OR "paymentStatus" <> 'PAID' OR "queuedAt" IS NULL OR "paidAt" IS NULL OR "queuedAt" < "paidAt"
      OR ("preparationStatus" = 'QUEUED' AND ("preparationStartedAt" IS NOT NULL OR "preparationStartedBy" IS NOT NULL))
      OR ("preparationStatus" IN ('PREPARING', 'READY', 'COMPLETED') AND ("preparationStartedAt" IS NULL OR "preparationStartedBy" IS NULL OR "preparationStartedAt" < "queuedAt"))
      OR ("preparationStatus" IN ('READY', 'COMPLETED') AND ("preparationReadyAt" IS NULL OR "preparationReadyBy" IS NULL OR "preparationReadyAt" < "preparationStartedAt"))
      OR ("preparationStatus" = 'COMPLETED' AND ("completedAt" IS NULL OR "completedBy" IS NULL OR "completedAt" < "preparationReadyAt"))
    )`);
  assert.equal(
    timeline.invalid_count,
    0,
    'Saved preparation records must have a valid paid/queue/start/ready/completion timeline.',
  );
  await client.query('COMMIT');
  console.log(
    'Passed: deployed preparation/completion fields and index, validated constraints, enabled first-entry/lifecycle guards, consistent saved timelines, and preserved orders RLS/browser read restrictions. Read-only verification.',
  );
} finally {
  await client.end();
}
