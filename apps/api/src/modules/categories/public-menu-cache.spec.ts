import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PublicMenuCache, publicMenuCachePolicy } from './public-menu-cache.js';

const fixture = (overrides: Record<string, unknown> = {}) =>
  new PublicMenuCache(
    new ConfigService({
      PUBLIC_MENU_CACHE_ENABLED: true,
      PUBLIC_MENU_CACHE_TTL_MS: 100,
      PUBLIC_MENU_CACHE_MAX_ENTRIES: 3,
      PUBLIC_MENU_CACHE_MAX_BYTES: 2048,
      PUBLIC_MENU_CACHE_MAX_ENTRY_BYTES: 1024,
      PUBLIC_MENU_CACHE_MAX_IN_FLIGHT: 1,
      ...overrides,
    }),
  );
afterEach(() => vi.useRealTimers());
describe('Bounded public catalog cache', () => {
  it('expires entries and never extends TTL on reads', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const cache = fixture(),
      load = vi.fn().mockResolvedValue('public');
    expect(await cache.getOrLoad('shop:revision:page', load)).toBe('public');
    vi.setSystemTime(1099);
    await cache.getOrLoad('shop:revision:page', load);
    vi.setSystemTime(1101);
    await cache.getOrLoad('shop:revision:page', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.snapshot()).toMatchObject({ hits: 1, expired: 1 });
  });
  it('coalesces concurrent loads and removes failed promises so the next request retries', async () => {
    const cache = fixture(),
      load = vi
        .fn()
        .mockRejectedValueOnce(new Error('fixture'))
        .mockResolvedValueOnce('fresh');
    const outcomes = await Promise.allSettled([
      cache.getOrLoad('a', load),
      cache.getOrLoad('a', load),
    ]);
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(
      true,
    );
    expect(cache.snapshot()).toMatchObject({
      coalesced: 1,
      loadErrors: 1,
      entries: 0,
      inFlight: 0,
    });
    expect(await cache.getOrLoad('a', load)).toBe('fresh');
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('removes a synchronously throwing loader and does not negatively cache it', async () => {
    const cache = fixture();
    await expect(
      cache.getOrLoad('a', () => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    expect(cache.snapshot().inFlight).toBe(0);
    expect(await cache.getOrLoad('a', async () => 'retry')).toBe('retry');
  });
  it('uses LRU and byte budgets without exposing keys or payloads through metrics', async () => {
    const cache = fixture({ PUBLIC_MENU_CACHE_MAX_ENTRIES: 2 });
    await cache.getOrLoad('a', async () => 'one');
    await cache.getOrLoad('b', async () => 'two');
    await cache.getOrLoad('a', async () => 'unexpected');
    await cache.getOrLoad('c', async () => 'three');
    const reload = vi.fn().mockResolvedValue('new');
    await cache.getOrLoad('b', reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(cache.snapshot().entries).toBe(2);
    expect(JSON.stringify(cache.snapshot())).not.toContain('three');
    const bytes = fixture({
      PUBLIC_MENU_CACHE_MAX_BYTES: 1024,
      PUBLIC_MENU_CACHE_MAX_ENTRY_BYTES: 900,
    });
    await bytes.getOrLoad('a', async () => 'x'.repeat(700));
    await bytes.getOrLoad('b', async () => 'y'.repeat(700));
    expect(bytes.snapshot()).toMatchObject({
      entries: 1,
      bytes: 701,
      evictions: 1,
    });
  });
  it('returns oversized values without retaining them', async () => {
    const cache = fixture(),
      load = vi.fn().mockResolvedValue('x'.repeat(1025));
    await cache.getOrLoad('a', load);
    await cache.getOrLoad('a', load);
    expect(cache.snapshot()).toMatchObject({
      entries: 0,
      bytes: 0,
      oversized: 2,
    });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('bounds distinct in-flight keys and bypasses cache when that capacity is full', async () => {
    const cache = fixture();
    let release!: (body: string) => void;
    const first = cache.getOrLoad(
      'a',
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    expect(await cache.getOrLoad('b', async () => 'direct')).toBe('direct');
    expect(cache.snapshot()).toMatchObject({
      inFlight: 1,
      bypassed: 1,
      entries: 0,
    });
    release('completed');
    await first;
    expect(cache.snapshot().inFlight).toBe(0);
  });
  it('supports disabling and prevents late cache fills after shutdown', async () => {
    const disabled = fixture({ PUBLIC_MENU_CACHE_ENABLED: false }),
      load = vi.fn().mockResolvedValue('live');
    await disabled.getOrLoad('a', load);
    await disabled.getOrLoad('a', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(disabled.snapshot().entries).toBe(0);
    const cache = fixture();
    let release!: (body: string) => void;
    const work = cache.getOrLoad(
      'a',
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    cache.onModuleDestroy();
    release('old');
    await work;
    expect(cache.enabled).toBe(false);
    expect(cache.snapshot()).toMatchObject({
      entries: 0,
      bytes: 0,
      inFlight: 0,
    });
  });
  it.each([
    { PUBLIC_MENU_CACHE_TTL_MS: 0 },
    { PUBLIC_MENU_CACHE_MAX_ENTRIES: 0 },
    { PUBLIC_MENU_CACHE_MAX_BYTES: 0 },
    { PUBLIC_MENU_CACHE_MAX_ENTRY_BYTES: 999999999 },
    { PUBLIC_MENU_CACHE_MAX_IN_FLIGHT: 0 },
    { PUBLIC_MENU_CACHE_ENABLED: 'maybe' },
  ])('rejects unsafe configuration %j', (config) => {
    expect(() => publicMenuCachePolicy(config)).toThrow();
  });
});
