import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExternalOperation } from './external-service.metrics.js';

export type ApiObservation = {
  requestId: string;
  failure?:
    'server-error' | 'database-busy' | 'dependency-timeout' | 'request-timeout';
  database: { count: number; failures: number; totalMs: number; maxMs: number };
  external: Record<
    ExternalOperation,
    {
      count: number;
      failures: number;
      totalMs: number;
      maxMs: number;
      buckets: number[];
    }
  >;
};
export const apiObservation = new AsyncLocalStorage<ApiObservation>();

export function recordDatabaseTiming(ms: number, failed: boolean) {
  const observation = apiObservation.getStore();
  if (!observation) return;
  observation.database.count++;
  observation.database.failures += Number(failed);
  observation.database.totalMs += ms;
  observation.database.maxMs = Math.max(observation.database.maxMs, ms);
}
