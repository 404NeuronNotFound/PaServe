// Starts only its own disposable cluster; never reads the application's DATABASE_URL.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, unlink, rm } from 'node:fs/promises';
import { resolve, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

const execute = promisify(execFile);
const suite = process.argv[2] ?? 'timeouts';
assert.ok(
  [
    'timeouts',
    'idempotency',
    'pooling',
    'indexing',
    'tenants',
    'caching',
  ].includes(suite),
  'Choose a supported local database suite.',
);
const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const toolsRoot = resolve(apiRoot, '../../.local-tools');
const binaryRoot =
  process.env.PG_BIN ??
  (process.platform === 'win32'
    ? join(toolsRoot, 'postgresql-17.11/pgsql/bin')
    : '');
const binary = (name) =>
  binaryRoot
    ? join(binaryRoot, `${name}${process.platform === 'win32' ? '.exe' : ''}`)
    : name;
const command = (name, args) =>
  execute(binary(name), args, {
    cwd: apiRoot,
    windowsHide: true,
    timeout: 25_000,
    maxBuffer: 1024 * 1024,
  });

await command('postgres', ['--version']);
await mkdir(toolsRoot, { recursive: true });
const clusterRoot = await mkdtemp(join(toolsRoot, 'timeout-pg-'));
const data = join(clusterRoot, 'data');
const passwordFile = join(clusterRoot, 'fixture-password');
const password = randomBytes(24).toString('hex');
const listener = createServer();
await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', resolve);
});
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
let initialized = false;
let stopped = false;
async function cleanup() {
  if (initialized) {
    try {
      await command('pg_ctl', [
        '-D',
        data,
        '-m',
        'fast',
        '-w',
        '-t',
        '15',
        'stop',
      ]);
      stopped = true;
    } catch (error) {
      try {
        await command('pg_ctl', ['-D', data, 'status']);
      } catch (status) {
        if (status.code === 3) stopped = true;
      }
      if (!stopped) throw error;
    }
  } else stopped = true;
  if (stopped) {
    // Verify the absolute deletion target is our own newly-created workspace cluster.
    const target = resolve(clusterRoot);
    assert.ok(
      target.startsWith(toolsRoot + sep) &&
        basename(target).startsWith('timeout-pg-'),
    );
    await rm(target, { recursive: true, force: true });
  }
}
try {
  await writeFile(passwordFile, password, { mode: 0o600 });
  await command('initdb', [
    '-D',
    data,
    '-U',
    'timeout_fixture',
    '--pwfile',
    passwordFile,
    '--auth-host=scram-sha-256',
    '--auth-local=trust',
    '--encoding=UTF8',
    '--no-locale',
    '--no-sync',
  ]);
  initialized = true;
  await unlink(passwordFile);
  await command('pg_ctl', [
    '-D',
    data,
    '-l',
    join(clusterRoot, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -c listen_addresses=127.0.0.1 -c max_connections=12`,
    '-w',
    '-t',
    '15',
    'start',
  ]);
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://timeout_fixture:${password}@127.0.0.1:${port}/postgres`,
    TIMEOUT_DB_LOCAL_FIXTURE: 'true',
    TIMEOUT_DB_REPORT: resolve(
      apiRoot,
      suite === 'timeouts'
        ? '../../artifacts/performance/request-timeouts-postgres-local.json'
        : suite === 'idempotency'
          ? '../../artifacts/performance/idempotency-postgres-local.json'
          : suite === 'indexing'
            ? '../../artifacts/performance/database-indexing-local.json'
            : suite === 'tenants'
              ? '../../artifacts/performance/tenant-query-performance-local.json'
              : suite === 'caching'
                ? '../../artifacts/performance/caching-local.json'
                : '../../artifacts/performance/database-pooling-local.json',
    ),
    ...(suite !== 'timeouts'
      ? {
          NODE_ENV: 'test',
          JWT_ACCESS_SECRET:
            'fixture-only-idempotency-access-secret-at-least-32-characters',
          JWT_REFRESH_SECRET:
            'fixture-only-idempotency-refresh-secret-at-least-32-characters',
          AUTH_BOT_CHALLENGE_ENABLED: 'false',
          SUPABASE_URL: 'http://127.0.0.1:1',
          SUPABASE_SERVICE_ROLE_KEY: 'fixture-only-no-live-provider',
        }
      : {}),
  };
  const result = await execute(
    process.execPath,
    [
      suite === 'timeouts'
        ? 'test/request-timeouts.database-check.mjs'
        : suite === 'idempotency'
          ? 'test/idempotency.database-check.mjs'
          : suite === 'indexing'
            ? 'test/database-indexing.database-check.mjs'
            : suite === 'tenants'
              ? 'test/tenant-performance.database-check.mjs'
              : suite === 'caching'
                ? 'test/caching.database-check.mjs'
                : 'test/database-pooling.database-check.mjs',
    ],
    {
      cwd: apiRoot,
      env,
      windowsHide: true,
      timeout: suite === 'timeouts' ? 30_000 : 90_000,
      maxBuffer: 1024 * 1024,
    },
  );
  process.stdout.write(result.stdout);
} finally {
  await cleanup();
}
