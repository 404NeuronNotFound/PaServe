import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';
const options = {
  databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
  directory: 'fixture-directory',
  report: 'fixture-report',
};
await test('strips inherited secrets, production targets, proxies and process injection flags', () => {
  const result = loadFixtureEnvironment(
    {
      Path: 'operating-system-path',
      SystemRoot: 'system-root',
      DATABASE_URL: 'production-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'production-secret',
      NODE_ENV: 'production',
      NODE_OPTIONS: '--import=untrusted',
      HTTP_PROXY: 'production-proxy',
      FRONTEND_ORIGINS: 'production-secret',
      LOAD_BASE_URL: 'production-secret',
    },
    options,
  );
  assert.equal(result.Path, 'operating-system-path');
  assert.equal(result.DATABASE_URL, options.databaseUrl);
  assert.equal(result.PASERVE_IGNORE_ENV_FILE, 'true');
  assert.equal(result.NODE_ENV, 'test');
  assert.equal(result.NODE_OPTIONS, undefined);
  assert.equal(result.HTTP_PROXY, undefined);
  assert.ok(!JSON.stringify(result).includes('production-secret'));
  assert.notEqual(
    result.JWT_ACCESS_SECRET,
    loadFixtureEnvironment({}, options).JWT_ACCESS_SECRET,
  );
});
await test('refuses database URLs not matching the owned-cluster contract', () => {
  for (const databaseUrl of [
    'postgresql://timeout_fixture:a@production.example.com/postgres',
    options.databaseUrl + '?host=production.example.com',
    options.databaseUrl.replace('timeout_fixture', 'postgres'),
    options.databaseUrl.replace('/postgres', '/production'),
  ])
    assert.throws(() =>
      loadFixtureEnvironment({}, { ...options, databaseUrl }),
    );
});
