// Owned-fixture instrumentation only. Fixed-cardinality aggregates; no request data.
export function instrumentCapacity(
  { rateStorage, fairness, admission, menuGate, poolAdapter },
  phase,
  now = () => performance.now(),
) {
  const began = now(),
    events = new Map(),
    restore = [];
  let sequence = 0,
    truncated = false;
  const record = (component, reason) => {
    const current = phase();
    if (
      !/^capacity-(?:level|confirmation|recovery|headroom)-[0-6]$/u.test(
        current,
      )
    )
      return;
    const key = `${current}:${component}:${reason}`;
    if (events.has(key)) {
      events.get(key).count++;
      return;
    }
    if (events.size >= 128) {
      truncated = true;
      return;
    }
    events.set(key, {
      sequence: ++sequence,
      elapsedMs: now() - began,
      phase: current,
      component,
      reason,
      count: 1,
    });
  };
  const replace = (object, key, factory) => {
    const original = object[key];
    if (typeof original !== 'function')
      throw new Error('Missing capacity instrumentation point.');
    object[key] = factory(original);
    restore.push(() => {
      object[key] = original;
    });
  };
  try {
    replace(
      rateStorage,
      'increment',
      (original) =>
        function (...args) {
          return original.apply(this, args).then((result) => {
            if (result.isBlocked)
              record('IP-route-rate-limit', 'window-exhausted');
            return result;
          });
        },
    );
    replace(
      fairness,
      'acquire',
      (original) =>
        function (...args) {
          const before = this.snapshot();
          try {
            return original.apply(this, args);
          } catch (error) {
            const after = this.snapshot();
            if (after.rateRejected > before.rateRejected)
              record('tenant-account-fairness', 'rate');
            else if (after.concurrencyRejected > before.concurrencyRejected)
              record('tenant-account-fairness', 'concurrency');
            else if (after.capacityRejected > before.capacityRejected)
              record('tenant-account-fairness', 'scope-capacity');
            throw error;
          }
        },
    );
    replace(
      admission,
      'acquire',
      (original) =>
        function (...args) {
          try {
            return original.apply(this, args);
          } catch (error) {
            if (error.getStatus?.() === 503)
              record('API-admission', 'concurrency');
            throw error;
          }
        },
    );
    replace(
      menuGate,
      'busy',
      (original) =>
        function (...args) {
          record('public-menu-gate', 'bounded-queue');
          return original.apply(this, args);
        },
    );
    const pool = poolAdapter.pool;
    if (!pool) throw new Error('Owned API pool is not initialized.');
    replace(
      pool,
      'connect',
      (original) =>
        function (...args) {
          const before = poolAdapter.snapshot().rejected;
          let recorded = false;
          const failed = (reason) => {
            if (!recorded) {
              recorded = true;
              record('DB-connection-pool', reason);
            }
          };
          if (typeof args[0] === 'function') {
            const callback = args[0];
            args[0] = (...values) => {
              if (values[0]) failed('acquisition');
              return callback(...values);
            };
          }
          const result = original.apply(this, args);
          if (poolAdapter.snapshot().rejected > before)
            failed('waiter-capacity');
          return result?.then
            ? result.catch((error) => {
                failed('acquisition');
                throw error;
              })
            : result;
        },
    );
  } catch (error) {
    for (const undo of restore.reverse()) undo();
    throw error;
  }
  return {
    snapshot: () => ({
      clock:
        'single API-process monotonic clock; first observed component rejection',
      truncated,
      events: [...events.values()].map((e) => ({ ...e })),
    }),
    restore: () => {
      for (const undo of restore.reverse()) undo();
    },
  };
}
