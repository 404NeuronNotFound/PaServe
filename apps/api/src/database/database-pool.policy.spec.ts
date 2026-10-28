import { databasePoolPolicy } from './database-pool.policy.js';
import { databaseTimeoutKind } from './database-timeout-error.js';

describe('database pool safety policy', () => {
  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '51', ''])(
    'rejects unsafe connection cap %s',
    (value) => {
      expect(() => databasePoolPolicy({ DB_POOL_MAX: value })).toThrow();
    },
  );
  it.each([
    { DB_POOL_MAX_WAITING: '-1' },
    { DB_POOL_MAX_WAITING: '201' },
    { DB_POOL_IDLE_TIMEOUT_MS: '0' },
    { DB_POOL_MAX_LIFETIME_SECONDS: '0' },
    { DB_POOL_CONNECTION_BUDGET: '10' },
    { DB_POOL_MAX_PROCESSES: '2' },
    {
      DB_POOL_MAX: '5',
      DB_POOL_MAX_PROCESSES: '3',
      DB_POOL_CONNECTION_BUDGET: '14',
    },
  ])(
    'rejects unbounded lifecycle/queue settings and inconsistent process budgets',
    (settings) => {
      expect(() => databasePoolPolicy(settings)).toThrow();
    },
  );
  it('accepts fail-fast queueing and a declared process budget at its safe boundary', () => {
    const policy = databasePoolPolicy({
      DB_POOL_MAX: '5',
      DB_POOL_MAX_WAITING: '0',
      DB_POOL_MAX_PROCESSES: '3',
      DB_POOL_CONNECTION_BUDGET: '15',
    });
    expect(policy.maxWaiting).toBe(0);
    expect(policy.max * policy.declaredProcesses!).toBe(
      policy.connectionBudget,
    );
  });
  it('recognizes structured capacity errors through adapter wrapping without matching wording', () => {
    expect(
      databaseTimeoutKind({
        meta: { driverAdapterError: { cause: { originalCode: '53300' } } },
      }),
    ).toBe('busy');
    expect(
      databaseTimeoutKind(new Error('53300 connection string private data')),
    ).toBeUndefined();
  });
});
