import 'dotenv/config';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { databaseConnection } from '../src/database/database-connection.ts';

// SELECT-only checks, additionally protected by an explicit read-only transaction.
const client = new pg.Client({
  ...databaseConnection(process.env, true),
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '10s'");
  const query = async (sql) => (await client.query(sql)).rows;
  const mode = (await query('SHOW transaction_read_only'))[0]
    .transaction_read_only;
  if (mode !== 'on') throw new Error('READ_ONLY_REQUIRED');
  const report = {
    readOnlyTransaction: true,
    clientTls: client.connection?.stream?.encrypted === true,
    clientTlsAuthorized: client.connection?.stream?.authorized === true,
    sharedSecurityTable: (
      await query(
        "SELECT to_regclass('public.security_state') IS NOT NULL AS present",
      )
    )[0].present,
    cacheTable: (
      await query(
        "SELECT to_regclass('public.menu_cache_versions') IS NOT NULL AS present",
      )
    )[0].present,
    policyColumns: (
      await query(
        "SELECT count(*)::int AS present FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name IN ('registrationPolicyVersion','termsAcceptedAt','privacyAcknowledgedAt','adultDeclaredAt')",
      )
    )[0].present,
    invalidShops: (
      await query(
        'SELECT count(*)::int AS count FROM public.shops WHERE NOT (char_length(name) BETWEEN 1 AND 120 AND char_length(btrim(name)) > 0) OR char_length(description)>1000',
      )
    )[0].count,
    invalidCategories: (
      await query(
        'SELECT count(*)::int AS count FROM public.categories WHERE NOT (char_length(name) BETWEEN 1 AND 80 AND char_length(btrim(name)) > 0) OR char_length(description)>500',
      )
    )[0].count,
    invalidProducts: (
      await query(
        'SELECT count(*)::int AS count FROM public.products WHERE NOT (char_length(name) BETWEEN 1 AND 120 AND char_length(btrim(name)) > 0) OR char_length(description)>2000 OR "sortOrder"<0 OR "featuredSortOrder"<0',
      )
    )[0].count,
    requestAliases: (
      await query(
        'SELECT count(*)::int AS count FROM (SELECT 1 FROM public.orders GROUP BY "shopId",lower("requestId") HAVING count(*)>1) conflicts',
      )
    )[0].count,
    paymentAliases: (
      await query(
        'SELECT count(*)::int AS count FROM (SELECT 1 FROM public.orders WHERE "paymentRequestId" IS NOT NULL GROUP BY "shopId",lower("paymentRequestId") HAVING count(*)>1) conflicts',
      )
    )[0].count,
  };
  await client.query('ROLLBACK');
  const json = JSON.stringify(report, null, 2) + '\n';
  if (process.argv[2]) await writeFile(process.argv[2], json);
  console.log(json);
} catch (error) {
  console.error(
    JSON.stringify({
      check: 'deployment-preflight',
      code: error.code ?? 'UNAVAILABLE',
      message:
        'Read-only preflight failed. No connection strings or row contents are printed.',
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
