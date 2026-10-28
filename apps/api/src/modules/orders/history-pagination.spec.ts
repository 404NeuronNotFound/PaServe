import { describe, expect, it, vi } from 'vitest';
import { parseHistoryPaging, readHistoryPage } from './history-pagination.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

describe('History page validation', () => {
  it('keeps legacy cursors separate and issues a server cutoff for a new view', () => {
    expect(parseHistoryPaging({})).toBeUndefined();
    const before = Date.now();
    const parsed = parseHistoryPaging({ page: '1' })!;
    expect(parsed.page).toBe(1);
    expect(parsed.snapshot.getTime()).toBeGreaterThanOrEqual(before);
    expect(parsed.snapshot.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it.each(['0', '-1', '1.5', '01', '1000000000', ['1'], {}, null])(
    'rejects invalid pages: %s',
    (page) => {
      expect(() => parseHistoryPaging({ page })).toThrow();
    },
  );
  it.each([
    'bad',
    '2026-02-30T00:00:00.000Z',
    '2999-01-01T00:00:00.000Z',
    ['2026-01-01T00:00:00.000Z'],
  ])('rejects invalid snapshots: %s', (snapshot) => {
    expect(() => parseHistoryPaging({ page: '1', snapshot })).toThrow();
  });
  it('rejects mixed cursor and numbered pagination, including snapshot without page', () => {
    expect(() => parseHistoryPaging({ page: '1' }, 'cursor')).toThrow();
    expect(() =>
      parseHistoryPaging({ snapshot: '2026-01-01T00:00:00.000Z' }),
    ).toThrow();
  });
});

describe('History tenant boundary', () => {
  it.each([
    {},
    { shopId: undefined },
    { shopId: '' },
    { shopId: 'invalid' },
    { shopId: { in: [] } },
    { shopId: { not: 'another-shop' } },
  ])(
    'rejects missing or broad tenant predicates before database work: %j',
    async (where) => {
      const transaction = vi.fn();
      const read = vi.fn();
      await expect(
        readHistoryPage(
          { $transaction: transaction } as unknown as PrismaService,
          { page: 1, snapshot: new Date() },
          where as Prisma.OrderWhereInput,
          {},
          read,
        ),
      ).rejects.toMatchObject({ response: { code: 'INVALID_TENANT_CONTEXT' } });
      expect(transaction).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );
});
