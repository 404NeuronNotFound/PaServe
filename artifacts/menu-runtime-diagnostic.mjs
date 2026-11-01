import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const pg = require('pg');
const env = parseEnv(fs.readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8'));
const webEnv = parseEnv(fs.readFileSync(new URL('../apps/web/.env', import.meta.url), 'utf8'));
const db = new URL(env.DATABASE_URL), api = new URL(env.SUPABASE_URL), web = new URL(webEnv.VITE_SUPABASE_URL);
console.log(JSON.stringify({ databaseHostKind: db.hostname.endsWith('pooler.supabase.com') ? 'supabase-pooler' : 'other',
  apiAndWebSameProject: api.hostname === web.hostname,
  databaseMatchesProject: db.hostname === 'db.' + api.hostname || decodeURIComponent(db.username).endsWith('.' + api.hostname.split('.')[0]),
  runtimePort: db.port }));
const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
try {
  await client.connect();
  console.log(JSON.stringify((await client.query("SELECT to_regclass('public.menu_cache_versions') IS NOT NULL cache_table, to_regclass('public._prisma_migrations') IS NOT NULL migration_table")).rows[0]));
  if ((await client.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL present")).rows[0].present) {
    const names = (await client.query('SELECT migration_name, finished_at IS NOT NULL finished, rolled_back_at IS NOT NULL rolled_back FROM public._prisma_migrations ORDER BY migration_name')).rows;
    const files = fs.readdirSync(new URL('../apps/api/prisma/migrations/', import.meta.url)).filter((s) => /^\d/u.test(s));
    console.log(JSON.stringify({ pending: files.filter((name) => !names.some((r) => r.migration_name === name && r.finished && !r.rolled_back)), failed: names.filter((r) => !r.finished && !r.rolled_back).map((r) => r.migration_name) }));
  }
} catch (error) { console.log(JSON.stringify({ name: error.name, code: error.code })); process.exitCode = 1; }
finally { await client.end(); }
