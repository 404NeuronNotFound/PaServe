import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadDatasetPlan } from './load-dataset.mjs';

export function operatingSystemEnvironment(parent) {
  return Object.fromEntries(
    Object.entries(parent).filter(([key]) =>
      /^(path|systemroot|windir|temp|tmp|userprofile|localappdata|appdata|comspec|pathext|systemdrive|number_of_processors|processor_architecture)$/i.test(
        key,
      ),
    ),
  );
}

/** Never inherit application secrets, proxy settings, NODE_OPTIONS or .env. */
export function loadFixtureEnvironment(
  parent,
  { databaseUrl, report, directory, search = false },
) {
  const database = new URL(databaseUrl);
  assert.ok(
    database.protocol === 'postgresql:' &&
      database.hostname === '127.0.0.1' &&
      database.port &&
      database.username === 'timeout_fixture' &&
      /^[a-f0-9]{48}$/.test(database.password) &&
      database.pathname === '/postgres' &&
      !database.search &&
      !database.hash,
    'Only an owned disposable database URL is allowed.',
  );
  const operatingSystem = operatingSystemEnvironment(parent);
  const dataset = loadDatasetPlan(
    parent.LOAD_DATASET_PROFILE ?? 'representative',
  );
  return {
    ...operatingSystem,
    NODE_ENV: 'test',
    PASERVE_IGNORE_ENV_FILE: 'true',
    DATABASE_URL: databaseUrl,
    DIRECT_DATABASE_URL: '',
    TIMEOUT_DB_LOCAL_FIXTURE: 'true',
    TIMEOUT_DB_REPORT: report,
    LOAD_FIXTURE_DIRECTORY: directory,
    LOAD_FIXTURE_SEARCH: search ? '1' : '0',
    LOAD_DATASET_PROFILE: dataset.profile,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    AUTH_BOT_CHALLENGE_ENABLED: 'false',
    TURNSTILE_SECRET_KEY: '',
    FRONTEND_ORIGINS: 'http://127.0.0.1',
    TRUSTED_PROXIES: '',
    SUPABASE_URL: 'http://127.0.0.1:1',
    SUPABASE_SERVICE_ROLE_KEY: 'disposable-fixture-no-provider',
  };
}
