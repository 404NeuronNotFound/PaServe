import { ConfigService } from '@nestjs/config';
import { SharedSecurityState } from './shared-security-state.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { PostgresRateLimitStorage } from './postgres-rate-limit.storage.js';

const secret = 'fixture-shared-secret-at-least-32-characters';
const config = (values = {}) =>
  new ConfigService({
    SECURITY_STATE_MODE: 'postgres',
    SECURITY_STATE_SECRET: secret,
    ...values,
  });
const database = (query = vi.fn()) =>
  ({ $queryRaw: query }) as unknown as PrismaService;

it('rejects local state on Vercel, unknown modes and missing shared secrets', () => {
  expect(
    () =>
      new SharedSecurityState(
        config({ VERCEL: '1', SECURITY_STATE_MODE: 'local' }),
        database(),
      ),
  ).toThrow('Vercel requires');
  expect(
    () =>
      new SharedSecurityState(
        config({ SECURITY_STATE_MODE: 'typo' }),
        database(),
      ),
  ).toThrow('local or postgres');
  expect(
    () =>
      new SharedSecurityState(
        config({ SECURITY_STATE_SECRET: '' }),
        database(),
      ),
  ).toThrow('32 characters');
});

it('uses the same private keys on independent instances without exposing raw identities', async () => {
  const query = vi
    .fn()
    .mockResolvedValue([{ hits: 1, retry: 60, accepted: true }]);
  const a = new SharedSecurityState(config(), database(query));
  const b = new SharedSecurityState(config(), database(query));
  expect(a.key('owner@example.test')).toBe(b.key('owner@example.test'));
  expect(a.key('owner@example.test')).not.toContain('owner');
  await a.operate('owner@example.test', 'hit');
  expect(query.mock.calls[0][1]).toMatch(/^[a-f0-9]{64}$/);
});

it('fails closed when the migration/database is unavailable', async () => {
  const state = new SharedSecurityState(
    config(),
    database(vi.fn().mockRejectedValue(new Error('secret provider error'))),
  );
  await expect(state.operate('token', 'reserve')).rejects.toMatchObject({
    status: 503,
    response: { code: 'SECURITY_STATE_UNAVAILABLE' },
  });
});

it('preserves the throttler contract and reports the shared retry interval', async () => {
  const operate = vi
    .fn()
    .mockResolvedValue({ hits: 6, retry: 8, accepted: false });
  const storage = new PostgresRateLimitStorage({
    operate,
  } as unknown as SharedSecurityState);
  expect(await storage.increment('source', 10000, 5, 0, 'default')).toEqual({
    totalHits: 6,
    timeToExpire: 8,
    isBlocked: true,
    timeToBlockExpire: 8,
  });
});
