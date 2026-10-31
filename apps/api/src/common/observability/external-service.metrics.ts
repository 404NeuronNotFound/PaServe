import { apiObservation } from './api-observation.context.js';

export type ExternalOperation =
  | 'http-headers'
  | 'turnstile-verification'
  | 'storage-upload'
  | 'storage-remove';
const boundsMs = [10, 50, 100, 250, 500, 1000, 3500, 10000];
export function externalCounters() {
  return {
    count: 0,
    failures: 0,
    totalMs: 0,
    maxMs: 0,
    buckets: Array<number>(boundsMs.length + 1).fill(0),
  };
}
export class ExternalServiceMetrics {
  private readonly groups = {
    'http-headers': externalCounters(),
    'turnstile-verification': externalCounters(),
    'storage-upload': externalCounters(),
    'storage-remove': externalCounters(),
  };
  async observe<T>(
    operation: ExternalOperation,
    work: () => PromiseLike<T>,
    failedResult: (value: T) => boolean = () => false,
  ): Promise<T> {
    const started = performance.now();
    // Capture before awaiting, so completion remains attached to its initiating request.
    const request = apiObservation.getStore();
    let failed = false;
    try {
      const result = await work();
      failed = failedResult(result);
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const ms = performance.now() - started;
      const targets = [this.groups[operation]];
      if (request) targets.push(request.external[operation]);
      for (const target of targets) {
        target.count++;
        target.failures += Number(failed);
        target.totalMs += ms;
        target.maxMs = Math.max(target.maxMs, ms);
        const bucket = boundsMs.findIndex((bound) => ms <= bound);
        target.buckets[bucket < 0 ? boundsMs.length : bucket]++;
      }
    }
  }
  snapshot() {
    return {
      boundsMs: [...boundsMs],
      operations: Object.fromEntries(
        Object.entries(this.groups).map(([key, group]) => [
          key,
          { ...group, buckets: [...group.buckets] },
        ]),
      ),
    };
  }
}
/** Process-lifetime aggregates also include background calls without HTTP requests. */
export const externalServiceMetrics = new ExternalServiceMetrics();
