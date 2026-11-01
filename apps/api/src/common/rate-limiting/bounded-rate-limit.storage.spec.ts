import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedRateLimitStorage } from './bounded-rate-limit.storage.js';

describe('bounded rate-limit identities', () => {
  const instances: BoundedRateLimitStorage[] = [];
  const create = (capacity = 2) => {
    const storage = new BoundedRateLimitStorage(capacity);
    instances.push(storage);
    return storage;
  };
  afterEach(() => {
    instances.forEach((storage) => storage.onApplicationShutdown());
    instances.length = 0;
    vi.useRealTimers();
  });
  it('bounds a simultaneous high-cardinality flood and keeps existing client limits', async () => {
    const storage = create(32);
    const results = await Promise.allSettled(
      Array.from({ length: 2000 }, (_, i) =>
        storage.increment(`source-${i}`, 60000, 2, 0, 'default'),
      ),
    );
    expect(
      results.filter((value) => value.status === 'fulfilled'),
    ).toHaveLength(32);
    expect(storage.storage.size).toBe(32);
    expect(
      await storage.increment('source-0', 60000, 2, 0, 'default'),
    ).toMatchObject({ isBlocked: false });
    expect(
      await storage.increment('source-0', 60000, 2, 0, 'default'),
    ).toMatchObject({ isBlocked: true });
    const rejection = results.find((value) => value.status === 'rejected');
    expect(
      rejection?.status === 'rejected' && rejection.reason.getStatus(),
    ).toBe(503);
  });
  it('reclaims expired identities through the framework sweep without forgetting live rolling hits', async () => {
    vi.useFakeTimers();
    const storage = create(1);
    await storage.increment('old', 100, 2, 0, 'default');
    await vi.advanceTimersByTimeAsync(59000);
    await expect(
      storage.increment('new', 100, 2, 0, 'default'),
    ).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await storage.increment('new', 100, 2, 0, 'default')).toMatchObject({
      isBlocked: false,
    });
    expect(storage.storage.size).toBe(1);
  });
  it('does not extend a rolling lockout when the same blocked client retries', async () => {
    vi.useFakeTimers();
    const storage = create();
    await storage.increment('source', 10000, 1, 0, 'default');
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      await storage.increment('source', 10000, 1, 0, 'default'),
    ).toMatchObject({ isBlocked: true, timeToBlockExpire: 5 });
    await vi.advanceTimersByTimeAsync(5001);
    expect(
      await storage.increment('source', 10000, 1, 0, 'default'),
    ).toMatchObject({ isBlocked: false });
  });
});
