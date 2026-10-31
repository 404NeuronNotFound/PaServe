import { requestContext } from '../common/http/request-context.js';

export type DatabaseWorkload = 'analytics' | 'orders' | 'other';
const boundsMs = [5, 10, 25, 50, 100, 250, 500, 1000, 5000];
function bucket() {
  return {
    count: 0,
    failures: 0,
    slow: 0,
    totalMs: 0,
    maxMs: 0,
    boundsMs: [...boundsMs],
    buckets: Array<number>(boundsMs.length + 1).fill(0),
  };
}

/** Fixed labels and histograms: no SQL, tenant IDs, parameters or per-query logs. */
export class DatabaseQueryMetrics {
  private readonly groups = {
    analytics: bucket(),
    orders: bucket(),
    other: bucket(),
  };
  async observe<T>(query: () => Promise<T>): Promise<T> {
    const group =
      this.groups[requestContext.getStore()?.databaseWorkload ?? 'other'];
    const started = performance.now();
    try {
      return await query();
    } catch (error) {
      group.failures++;
      throw error;
    } finally {
      const ms = performance.now() - started;
      group.count++;
      group.totalMs += ms;
      group.maxMs = Math.max(group.maxMs, ms);
      if (ms >= 250) group.slow++;
      const index = boundsMs.findIndex((bound) => ms <= bound);
      group.buckets[index < 0 ? boundsMs.length : index]++;
    }
  }
  snapshot() {
    return Object.fromEntries(
      Object.entries(this.groups).map(([key, value]) => [
        key,
        {
          ...value,
          boundsMs: [...value.boundsMs],
          buckets: [...value.buckets],
        },
      ]),
    );
  }
}
