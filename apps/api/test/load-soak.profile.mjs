import assert from 'node:assert/strict';
export function soakProfile(name = 'initial') {
  assert.ok(
    ['smoke', 'initial', 'extended', 'multi-hour'].includes(name),
    'Choose a fixed soak profile.',
  );
  return Object.freeze({
    version: 1,
    name,
    clients: 6,
    warmSeconds: name === 'smoke' ? 15 : 60,
    windowSeconds: name === 'smoke' ? 15 : 60,
    windows:
      name === 'smoke'
        ? 4
        : name === 'multi-hour'
          ? 180
          : name === 'extended'
            ? 60
            : 10,
    cooldownSeconds: name === 'smoke' ? 20 : 30,
    refreshEverySeconds: name === 'smoke' ? 30 : 120,
    churnEverySeconds: 60,
    requestMs: 5000,
    maxInFlight: 32,
    dispatchDelayMs: 150,
    p95Ms: 1000,
    p99Ms: 1500,
    maxRssBytes: 1024 * 1024 * 1024,
    maxHeapBytes: 512 * 1024 * 1024,
    maxExternalBytes: 128 * 1024 * 1024,
  });
}
export const soakSeconds = (p) =>
  p.warmSeconds + p.windowSeconds * p.windows + p.cooldownSeconds;
export const soakKinds = Object.freeze([
  'menu',
  'product',
  'order-status',
  'dashboard',
  'cashier',
  'kitchen',
]);
export const expectedSoakSessions = (p) =>
  3 +
  Math.floor(
    (p.warmSeconds + p.windows * p.windowSeconds - 1) / p.churnEverySeconds,
  );
export const expectedSoakRefreshes = (p) =>
  3 *
  Math.floor(
    (p.warmSeconds + p.windows * p.windowSeconds - 1) / p.refreshEverySeconds,
  );
