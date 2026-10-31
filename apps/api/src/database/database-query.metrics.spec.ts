import { DatabaseQueryMetrics } from './database-query.metrics.js';
import { requestContext } from '../common/http/request-context.js';

describe('database query workload metrics', () => {
  it('keeps concurrent analytics and orders isolated including failures', async () => {
    const metrics = new DatabaseQueryMetrics();
    const error = new Error('private SQL error');
    await Promise.all([
      requestContext.run(
        { signal: new AbortController().signal, databaseWorkload: 'analytics' },
        async () => {
          await Promise.resolve();
          await metrics.observe(async () => 1);
          await expect(
            metrics.observe(async () => {
              throw error;
            }),
          ).rejects.toBe(error);
        },
      ),
      requestContext.run(
        { signal: new AbortController().signal, databaseWorkload: 'orders' },
        async () => {
          await metrics.observe(async () => {
            await Promise.resolve();
            return 2;
          });
        },
      ),
    ]);
    await metrics.observe(async () => 3);
    const snapshot = metrics.snapshot();
    expect(snapshot.analytics.count).toBe(2);
    expect(snapshot.analytics.failures).toBe(1);
    expect(snapshot.orders.count).toBe(1);
    expect(snapshot.other.count).toBe(1);
    for (const group of Object.values(snapshot)) {
      expect(group.buckets.reduce((sum, count) => sum + count, 0)).toBe(
        group.count,
      );
      expect(group.totalMs).toBeGreaterThanOrEqual(group.maxMs);
    }
    expect(JSON.stringify(snapshot)).not.toContain('private');
    snapshot.analytics.buckets[0] = -1;
    expect(metrics.snapshot().analytics.buckets[0]).toBeGreaterThanOrEqual(0);
  });
});
