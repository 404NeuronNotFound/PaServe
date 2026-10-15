import 'dotenv/config';
import pg from 'pg';

// Read-only rollout audit. Does not change Supabase settings or apply migrations.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const expectedTriggers = [
  'orders_broadcast_new_workflow',
  'orders_broadcast_confirmed',
  'orders_broadcast_preparing',
  'orders_broadcast_ready',
  'orders_broadcast_completed',
  'products_broadcast_sold_out',
  'products_broadcast_available',
];
const expectedPolicies = [
  'staff_new_order_backend_only',
  'confirmed_order_backend_only',
  'preparing_order_backend_only',
  'menu_availability_backend_only',
  'app_realtime_backend_only',
];
try {
  await db.connect();
  await db.query('BEGIN READ ONLY');
  const messages = (
    await db.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid='realtime.messages'::regclass",
    )
  ).rows[0];
  const triggers = (
    await db.query(
      `SELECT t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname IN ('orders','products') AND t.tgname=ANY($1::text[]) AND NOT t.tgisinternal`,
      [expectedTriggers],
    )
  ).rows;
  const policies = (
    await db.query(
      "SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname=ANY($1::text[])",
      [expectedPolicies],
    )
  ).rows;
  const browserGrants = (
    await db.query(
      `SELECT t.relname,role_name,permission FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN unnest(ARRAY['anon','authenticated']) role_name CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) permission WHERE n.nspname='public' AND t.relname IN ('shops','shop_members','categories','products','orders','order_items','restaurant_tables') AND has_table_privilege(role_name,t.oid,permission)`,
    )
  ).rows;
  const missingTriggers = expectedTriggers.filter(
    (name) =>
      !triggers.some(
        (t) => t.tgname === name && ['O', 'A'].includes(t.tgenabled),
      ),
  );
  const prefixes = {
    staff_new_order_backend_only: ['staff:new-order:%'],
    confirmed_order_backend_only: ['staff:confirmed:%', 'customer:confirmed:%'],
    preparing_order_backend_only: ['staff:preparation:%'],
    menu_availability_backend_only: ['menu:availability:%'],
    app_realtime_backend_only: ['staff:%', 'customer:%', 'menu:availability:%'],
  };
  const normalize = (value) => (value ?? '').replace(/[\s()]/g, '');
  const missingPolicies = expectedPolicies.filter((name) => {
    const expected = prefixes[name]
      .map((prefix) => `topic!~~'${prefix}'::text`)
      .join('AND');
    return !policies.some(
      (policy) =>
        policy.policyname === name &&
        policy.permissive === 'RESTRICTIVE' &&
        policy.cmd === 'ALL' &&
        ['anon', 'authenticated'].every((role) =>
          policy.roles.includes(role),
        ) &&
        normalize(policy.qual) === expected &&
        normalize(policy.with_check) === expected,
    );
  });
  const ready =
    messages?.relrowsecurity === true &&
    !missingTriggers.length &&
    !missingPolicies.length &&
    !browserGrants.length;
  console.log(
    JSON.stringify(
      {
        ready,
        messagesRlsEnabled: messages?.relrowsecurity === true,
        missingTriggers,
        missingPolicies,
        browserGrants,
      },
      null,
      2,
    ),
  );
  await db.query('ROLLBACK');
  if (!ready) process.exitCode = 1;
} finally {
  await db.query('ROLLBACK').catch(() => undefined);
  await db.end();
}
