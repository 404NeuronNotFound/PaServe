import { describe, expect, it } from 'vitest';
import { parseHistoryPaging } from './history-pagination.js';

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
