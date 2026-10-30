// Starts only its own disposable cluster; never reads the application's DATABASE_URL.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  unlink,
  rm,
} from 'node:fs/promises';
import { resolve, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';
import { soakProfile, soakSeconds } from './load-soak.profile.mjs';
import { auditSoakDatabaseLog } from './load-soak.logs.mjs';

const execute = promisify(execFile);
const suite = process.argv[2] ?? 'timeouts';
const soakName =
  suite === 'load-soak-multi-hour'
    ? 'multi-hour'
    : suite === 'load-soak-smoke'
      ? 'smoke'
      : suite === 'load-soak-extended'
        ? 'extended'
        : suite === 'load-soak'
          ? 'initial'
          : '';
const soak = soakName ? soakProfile(soakName) : null;
const isolatedLoad = [
  'load',
  'load-search',
  'load-ramp',
  'load-ramp-diagnostic',
  'load-login-flood',
  'load-menu-spike',
  'load-order-burst',
  'load-spike',
  'load-soak',
  'load-soak-smoke',
  'load-soak-extended',
  'load-soak-multi-hour',
].includes(suite);
const shutdown = new AbortController();
const interrupt = () => {
  process.exitCode = 130;
  shutdown.abort();
};
const terminate = () => {
  process.exitCode = 143;
  shutdown.abort();
};
if (isolatedLoad) {
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
}
assert.ok(
  [
    'timeouts',
    'idempotency',
    'pooling',
    'indexing',
    'tenants',
    'caching',
    'load',
    'load-search',
    'load-ramp',
    'load-ramp-diagnostic',
    'load-login-flood',
    'load-menu-spike',
    'load-order-burst',
    'load-spike',
    'load-soak',
    'load-soak-smoke',
    'load-soak-extended',
    'load-soak-multi-hour',
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
const command = (name, args, cleanup = false) =>
  execute(binary(name), args, {
    cwd: apiRoot,
    windowsHide: true,
    timeout: 25_000,
    maxBuffer: 1024 * 1024,
    signal: isolatedLoad && !cleanup ? shutdown.signal : undefined,
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
let removed = false;
let loadSucceeded = false;
const loadReport = resolve(
  apiRoot,
  `../../artifacts/performance/load-environment${suite === 'load-search' ? '-search' : suite === 'load-ramp' ? '-ramp' : suite === 'load-ramp-diagnostic' ? '-ramp-diagnostic' : suite === 'load-login-flood' ? '-login-flood' : suite === 'load-menu-spike' ? '-menu-spike' : suite === 'load-order-burst' ? '-order-burst' : suite === 'load-spike' ? '-spike' : soak ? '-soak-' + soak.name : ''}-local.json`,
);
async function cleanup() {
  if (initialized) {
    try {
      await command(
        'pg_ctl',
        ['-D', data, '-m', 'fast', '-w', '-t', '15', 'stop'],
        true,
      );
      stopped = true;
    } catch (error) {
      try {
        await command('pg_ctl', ['-D', data, 'status'], true);
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
    removed = true;
  }
}
try {
  if (isolatedLoad) {
    await mkdir(resolve(apiRoot, '../../artifacts/performance'), {
      recursive: true,
    });
    await writeFile(
      loadReport,
      JSON.stringify({
        pass: false,
        environment: 'disposable-development',
        status: 'starting',
      }) + '\n',
    );
  }
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
      isolatedLoad
        ? 'test/load-environment.database-check.mjs'
        : suite === 'timeouts'
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
      env: isolatedLoad
        ? loadFixtureEnvironment(process.env, {
            databaseUrl: env.DATABASE_URL,
            report: loadReport,
            directory: clusterRoot,
            search: suite === 'load-search',
            ramp: suite.startsWith('load-ramp'),
            diagnostic: suite === 'load-ramp-diagnostic',
            loginFlood: suite === 'load-login-flood',
            menuSpike: suite === 'load-menu-spike',
            orderBurst: suite === 'load-order-burst',
            trafficSpike: suite === 'load-spike',
            soak: soakName,
          })
        : env,
      windowsHide: true,
      timeout: soak
        ? (soakSeconds(soak) + 240) * 1000
        : suite === 'timeouts'
          ? 30_000
          : suite.startsWith('load-ramp')
            ? 480_000
            : isolatedLoad
              ? 180_000
              : 90_000,
      signal: isolatedLoad ? shutdown.signal : undefined,
      maxBuffer: 1024 * 1024,
    },
  );
  process.stdout.write(result.stdout);
  loadSucceeded = true;
} finally {
  let databaseLogs;
  let databaseWholeLog;
  if (soak) {
    try {
      const childReport = JSON.parse(await readFile(loadReport, 'utf8'));
      assert.ok(Number.isSafeInteger(childReport.soak?.databaseLogOffset));
      databaseWholeLog = await auditSoakDatabaseLog(
        join(clusterRoot, 'postgres.log'),
      );
      databaseLogs = await auditSoakDatabaseLog(
        join(clusterRoot, 'postgres.log'),
        childReport.soak.databaseLogOffset,
      );
    } catch {
      databaseLogs = { pass: false, unreadable: true };
    }
  }
  try {
    await cleanup();
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    if (isolatedLoad) {
      let report = { pass: false, environment: 'disposable-development' };
      try {
        report = JSON.parse(await readFile(loadReport, 'utf8'));
      } catch {
        /* Failed startup may have no complete child report. */
      }
      if (soak) report.databaseLogs = databaseLogs;
      if (soak) report.databaseWholeLog = databaseWholeLog;
      report.pass = Boolean(
        report.pass &&
        loadSucceeded &&
        stopped &&
        removed &&
        (!soak || databaseLogs?.pass),
      );
      report.status = report.pass ? 'complete' : 'failed';
      if (soak && !report.pass) process.exitCode = 1;
      report.cleanup = {
        postgresStopped: stopped,
        ownedDirectoryRemoved: removed,
      };
      await writeFile(loadReport, JSON.stringify(report, null, 2) + '\n');
      if (soak)
        await writeFile(
          resolve(
            apiRoot,
            `../../artifacts/performance/load-soak-${soak.name}-progress-local.json`,
          ),
          JSON.stringify({
            runId: report.runId,
            profile: soak.name,
            status: report.status,
            pass: report.pass,
            cleanup: report.cleanup,
            finishedAt: new Date().toISOString(),
          }) + '\n',
        );
    }
  }
}
