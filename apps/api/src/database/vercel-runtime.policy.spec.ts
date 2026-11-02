import { validateVercelRuntime } from './vercel-runtime.policy.js';
const env = {
  VERCEL: '1',
  DATABASE_URL:
    'postgresql://fixture:fixture@pool.example.test/postgres?sslmode=verify-full',
  DB_POOL_MAX_PROCESSES: '10',
  DB_POOL_CONNECTION_BUDGET: '20',
};
it('leaves local development unchanged and accepts verified TLS and explicit budgets', () => {
  expect(() => validateVercelRuntime({})).not.toThrow();
  expect(() => validateVercelRuntime(env)).not.toThrow();
});
it.each([
  '',
  'postgresql://pool.example.test/db',
  'postgresql://pool.example.test/db?sslmode=require',
  'postgresql://pool.example.test/db?sslmode=no-verify',
])('rejects unverified Vercel database configuration', (DATABASE_URL) => {
  expect(() => validateVercelRuntime({ ...env, DATABASE_URL })).toThrow();
});
it('rejects disabled certificate verification, missing pool budgets and excessive stream setup', () => {
  expect(() =>
    validateVercelRuntime({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
  ).toThrow();
  expect(() =>
    validateVercelRuntime({ ...env, DB_POOL_MAX_PROCESSES: '' }),
  ).toThrow();
  expect(() =>
    validateVercelRuntime({ ...env, API_STREAM_SETUP_TIMEOUT_MS: 60000 }),
  ).toThrow();
});
