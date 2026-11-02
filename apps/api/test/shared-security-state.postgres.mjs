// Disposable loopback PostgreSQL only. Never reads DATABASE_URL or application env files.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import pg from 'pg';

const api = fileURLToPath(new URL('..', import.meta.url));
const tools = resolve(api, '../../.local-tools');
const cluster = await mkdtemp(join(tools, 'security-pg-'));
const bin =
  process.env.PG_BIN ??
  (process.platform === 'win32'
    ? join(tools, 'postgresql-17.11/pgsql/bin')
    : '');
const run = promisify(execFile);
const command = (name, args) =>
  run(
    bin ? join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name,
    args,
    { windowsHide: true, timeout: 30000 },
  );
const port = await new Promise((done, fail) => {
  const server = createServer();
  server.once('error', fail);
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => done(value));
  });
});
let started = false;
const apiConnections = [];
const pool = new pg.Pool({
  host: '127.0.0.1',
  port,
  user: 'security_fixture',
  database: 'postgres',
  max: 12,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});
const key = (name) => createHash('sha256').update(name).digest('hex');
const operate = async (name, op, ttl = 900000, limit = 20) =>
  (
    await pool.query(
      'SELECT * FROM public.paserve_security_state($1,$2,$3,$4)',
      [key(name), op, ttl, limit],
    )
  ).rows[0];
try {
  await command('initdb', [
    '-D',
    join(cluster, 'data'),
    '-U',
    'security_fixture',
    '--auth=trust',
    '--encoding=UTF8',
    '--no-locale',
    '--no-sync',
  ]);
  await command('pg_ctl', [
    '-D',
    join(cluster, 'data'),
    '-l',
    join(cluster, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -c listen_addresses=127.0.0.1`,
    '-w',
    'start',
  ]);
  started = true;
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated;');
  await pool.query(
    await readFile(
      join(
        api,
        'prisma/migrations/20261102020000_shared_security_state/migration.sql',
      ),
      'utf8',
    ),
  );
  // Exercise the actual compiled Prisma adapter and state service on two pools.
  process.env.DATABASE_URL = `postgresql://security_fixture@127.0.0.1:${port}/postgres`;
  delete process.env.DATABASE_CA_CERT;
  delete process.env.DATABASE_CA_CERT_PATH;
  const { PrismaService } = await import('../dist/database/prisma.service.js');
  const { SharedSecurityState } =
    await import('../dist/common/rate-limiting/shared-security-state.js');
  const { ConfigService } = await import('@nestjs/config');
  const sharedConfig = new ConfigService({
    SECURITY_STATE_MODE: 'postgres',
    SECURITY_STATE_SECRET: 'disposable-fixture-security-secret-32-characters',
  });
  const firstDb = new PrismaService(),
    secondDb = new PrismaService();
  apiConnections.push(firstDb, secondDb);
  const firstState = new SharedSecurityState(sharedConfig, firstDb);
  const secondState = new SharedSecurityState(sharedConfig, secondDb);
  assert.equal(
    (await firstState.operate('replica-token', 'reserve', 300000, 1)).accepted,
    true,
  );
  assert.equal(
    (await secondState.operate('replica-token', 'reserve', 300000, 1)).accepted,
    false,
  );
  assert.equal(
    (await firstState.operate('replica-rate', 'rate', 60000, 2)).accepted,
    true,
  );
  assert.equal(
    (await secondState.operate('replica-rate', 'rate', 60000, 2)).accepted,
    true,
  );
  assert.equal(
    (await firstState.operate('replica-rate', 'rate', 60000, 2)).accepted,
    false,
  );
  const reservations = await Promise.all(
    Array.from({ length: 30 }, () =>
      operate('same-token', 'reserve', 300000, 1),
    ),
  );
  assert.equal(
    reservations.filter((r) => r.accepted).length,
    1,
    'Concurrent instances reserve a token exactly once',
  );
  const hits = await Promise.all(
    Array.from({ length: 30 }, () => operate('risk', 'hit')),
  );
  assert.equal(Math.max(...hits.map((r) => r.hits)), 20);
  assert.equal(
    (await operate('risk', 'read')).hits,
    20,
    'Risk survives new connections',
  );
  await operate('risk', 'delete');
  assert.equal((await operate('risk', 'read')).hits, 0);
  const rate = await Promise.all(
    Array.from({ length: 30 }, () => operate('source', 'rate', 10000, 5)),
  );
  assert.equal(
    rate.filter((r) => r.accepted).length,
    5,
    'Shared rolling limit admits exactly its budget',
  );
  const before = (
    await pool.query('SELECT expires FROM security_state WHERE key=$1', [
      key('source'),
    ])
  ).rows[0].expires;
  await operate('source', 'rate', 10000, 5);
  const after = (
    await pool.query('SELECT expires FROM security_state WHERE key=$1', [
      key('source'),
    ])
  ).rows[0].expires;
  assert.equal(+before, +after, 'Denied attempts do not extend a lockout');
  await pool.query(
    "UPDATE security_state SET expires = clock_timestamp()-interval '1 second' WHERE key=$1",
    [key('source')],
  );
  assert.equal((await operate('source', 'rate', 10000, 5)).hits, 1);
  await pool.query(
    "UPDATE security_state SET arrivals = ARRAY[clock_timestamp()-interval '11 seconds'], expires=clock_timestamp()+interval '10 seconds' WHERE key=$1",
    [key('source')],
  );
  assert.equal(
    (await operate('source', 'rate', 10000, 5)).hits,
    1,
    'Old rolling arrivals expire',
  );
  for (const role of ['anon', 'authenticated']) {
    const privileges = (
      await pool.query(
        "SELECT has_table_privilege($1,'public.security_state','SELECT') AS read, has_function_privilege($1,'public.paserve_security_state(text,text,integer,integer)','EXECUTE') AS execute",
        [role],
      )
    ).rows[0];
    assert.deepEqual(privileges, { read: false, execute: false });
  }
  assert.equal(
    (
      await pool.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='public.security_state'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
  );
  await assert.rejects(operate('bad-op', 'invalid'));
  await assert.rejects(operate('bad-ttl', 'rate', 900001));
  await pool.query(
    "INSERT INTO security_state(key,expires) SELECT md5(i::text)||md5(i::text),clock_timestamp()+interval '1 minute' FROM generate_series(1,50000) i ON CONFLICT DO NOTHING",
  );
  await assert.rejects(operate('overflow', 'reserve'), /capacity reached/);
  assert.equal(
    (await operate('same-token', 'reserve', 300000, 1)).accepted,
    false,
    'Capacity pressure never erases active reservations',
  );
  console.log(
    'Shared security PostgreSQL checks passed: concurrency, replay, risk, rolling expiry, privacy privileges, capacity.',
  );
} finally {
  await Promise.all(apiConnections.map((db) => db.onModuleDestroy()));
  await pool.end();
  if (started)
    await command('pg_ctl', [
      '-D',
      join(cluster, 'data'),
      '-m',
      'fast',
      '-w',
      'stop',
    ]);
  const target = resolve(cluster);
  assert.ok(
    target.startsWith(tools + sep) &&
      target.split(sep).at(-1).startsWith('security-pg-'),
  );
  await rm(target, { recursive: true, force: true });
}
