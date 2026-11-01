// Reuse only the previously authorized development project, with the fixed
// 24-reader/three-instance profile. Never print credential-bearing configuration.
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { hostedFanoutSettings } from '../apps/api/test/realtime-fanout.settings.mjs';
assert.deepEqual(process.argv.slice(2), ['--run-disposable'], 'Use the explicit disposable-run flag');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { parse } = require('dotenv');
let privatePath;
try {
  const backend = parse(await readFile(resolve(root, 'apps/api/.env'), 'utf8'));
  const frontend = parse(await readFile(resolve(root, 'apps/web/.env'), 'utf8'));
  const url = new URL(backend.SUPABASE_URL);
  assert.equal(url.origin, new URL(frontend.VITE_SUPABASE_URL).origin);
  const projectRef = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1];
  assert.equal(projectRef, "etqqdkfmnosbrczdrpui", 'Project differs from the approved development fixture');
  const database = new URL(backend.DATABASE_URL);
  database.port = '5432';
  database.searchParams.delete('pgbouncer');
  const config = { environment: 'disposable-staging', projectRef, supabaseUrl: url.origin,
    serviceRoleKey: backend.SUPABASE_SERVICE_ROLE_KEY, databaseUrl: database.href,
    allowFixtureBroadcasts: true, allowTemporaryDatabaseFixtures: true };
  hostedFanoutSettings(config, projectRef, '--run-disposable');
  const directory = resolve(root, '.local-tools');
  await mkdir(directory, { recursive: true });
  privatePath = resolve(directory, `phase27-private-${randomUUID()}.json`);
  await writeFile(privatePath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ['test/realtime-fanout.mjs', 'hosted', privatePath, projectRef, '--run-disposable'],
      { cwd: resolve(root, 'apps/api'), windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (status) => resolveExit(status ?? 1));
  });
  process.exitCode = code;
} catch {
  console.error('Bounded hosted fan-out could not complete; inspect the sanitized report. No credentials were printed.');
  process.exitCode = 1;
} finally {
  if (privatePath) await unlink(privatePath);
}
