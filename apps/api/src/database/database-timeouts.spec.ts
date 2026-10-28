import { databaseTimeouts } from './database-timeouts.js';
import { databaseTimeoutKind } from './database-timeout-error.js';

describe('database deadlines', () => {
  it.each(['0', '-1', 'NaN', '1.5', '60001'])(
    'rejects unbounded/invalid durations %s',
    (value) => {
      expect(() =>
        databaseTimeouts({ DB_STATEMENT_TIMEOUT_MS: value }),
      ).toThrow();
    },
  );
  it('requires locks to time out before statements', () => {
    expect(() => databaseTimeouts({ DB_LOCK_TIMEOUT_MS: '10000' })).toThrow();
  });
  it.each([
    [{ code: '57014' }, 'deadline'],
    [{ code: 'P2010', meta: { code: '57014' } }, 'deadline'],
    [
      { meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } },
      'busy',
    ],
    [{ code: 'P2024' }, 'busy'],
    [{ code: 'P2002' }, undefined],
    [{ message: 'SQL 57014 with private query' }, undefined],
  ])('maps only known structured deadline codes', (error, expected) => {
    expect(databaseTimeoutKind(error)).toBe(expected);
  });
});
