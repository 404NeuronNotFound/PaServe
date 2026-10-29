import { ConfigService } from '@nestjs/config';
import {
  FairnessLimitedException,
  TrafficFairnessService,
  fairnessScopes,
} from './traffic-fairness.service.js';
import { RequestWork } from './request-work.js';

const tenant = (key = 'large') => [
  { key: `private:${key}`, kind: 'tenant' as const },
];
const account = (key = 'owner') => [
  { key: `account:${key}`, kind: 'account' as const },
];
const fixture = (settings = {}) =>
  new TrafficFairnessService(new ConfigService(settings));
afterEach(() => vi.useRealTimers());

describe('Per-shop and per-account fairness', () => {
  it('keeps bounded state headroom for new menus when rotating write targets exhaust ordinary state', () => {
    const service = fixture({ API_FAIR_MAX_SCOPES: 16 });
    for (let i = 0; i < 14; i++)
      service.acquire(
        [{ key: `public:writer-${i}`, kind: 'tenant' }],
        'general',
      )();
    expect(() =>
      service.acquire(
        [{ key: 'public:extra-writer', kind: 'tenant' }],
        'general',
      ),
    ).toThrow();
    service.acquire(
      [{ key: 'public:new-menu', kind: 'tenant' }],
      'general',
      true,
    )();
    service.acquire(
      [{ key: 'public:second-menu', kind: 'tenant' }],
      'general',
      true,
    )();
    expect(service.snapshot().trackedScopes).toBe(16);
    service.acquire([{ key: 'public:writer-0', kind: 'tenant' }], 'general')();
    expect(() =>
      service.acquire(
        [{ key: 'public:over-capacity', kind: 'tenant' }],
        'general',
        true,
      ),
    ).toThrow();
  });
  it('reserves public-menu slots without increasing the public-shop ordinary cap', () => {
    const service = fixture();
    const scope = [{ key: 'public:cafe', kind: 'tenant' as const }];
    const writes = Array.from({ length: 18 }, () =>
      service.acquire(scope, 'general'),
    );
    expect(() => service.acquire(scope, 'general')).toThrow(
      FairnessLimitedException,
    );
    const reads = Array.from({ length: 6 }, () =>
      service.acquire(scope, 'general', true),
    );
    expect(() => service.acquire(scope, 'general', true)).toThrow(
      FairnessLimitedException,
    );
    [...writes, ...reads].forEach((release) => release());
    expect(service.snapshot().activeScopeLeases).toBe(0);
  });
  it('keeps public menu and write tokens independent, then recovers both', () => {
    vi.useFakeTimers();
    const service = fixture({
      API_FAIR_TENANT_BURST: 2,
      API_FAIR_TENANT_PER_MINUTE: 60,
    });
    const scope = [{ key: 'public:cafe', kind: 'tenant' as const }];
    service.acquire(scope, 'general')();
    service.acquire(scope, 'general')();
    expect(() => service.acquire(scope, 'general')).toThrow();
    service.acquire(scope, 'general', true)();
    service.acquire(scope, 'general', true)();
    expect(() => service.acquire(scope, 'general', true)).toThrow();
    vi.advanceTimersByTime(1000);
    service.acquire(scope, 'general')();
    service.acquire(scope, 'general', true)();
  });
  it('limits a distributed tenant flood while another shop and critical work remain admissible', () => {
    const service = fixture();
    const leases = Array.from({ length: 24 }, () =>
      service.acquire(tenant(), 'general'),
    );
    expect(() => service.acquire(tenant(), 'general')).toThrow(
      FairnessLimitedException,
    );
    const small = service.acquire(tenant('small'), 'general');
    const cashier = service.acquire(tenant(), 'critical');
    small();
    cashier();
    leases.forEach((release) => {
      release();
      release();
    });
    expect(service.snapshot().activeScopeLeases).toBe(0);
  });
  it('limits one verified account across shops and IP changes', () => {
    const service = fixture();
    const leases = Array.from({ length: 6 }, (_, i) =>
      service.acquire([...tenant(String(i)), ...account()], 'general'),
    );
    expect(() =>
      service.acquire([...tenant('new'), ...account()], 'general'),
    ).toThrow(FairnessLimitedException);
    expect(service.snapshot().trackedScopes).toBe(7);
    service.acquire([...tenant('new'), ...account('another')], 'general')();
    leases.forEach((release) => release());
  });
  it('atomically charges scopes and never extends rate lockout with rejected retries', () => {
    vi.useFakeTimers();
    const service = fixture({
      API_FAIR_TENANT_BURST: 2,
      API_FAIR_TENANT_PER_MINUTE: 60,
    });
    service.acquire(tenant(), 'general')();
    service.acquire(tenant(), 'general')();
    for (let i = 0; i < 100; i++)
      expect(() =>
        service.acquire([...account('fresh'), ...tenant()], 'general'),
      ).toThrow(FairnessLimitedException);
    expect(service.snapshot().trackedScopes).toBe(1);
    // Critical token budget is independent of ordinary request spam.
    service.acquire(tenant(), 'critical')();
    vi.advanceTimersByTime(1000);
    service.acquire([...account('fresh'), ...tenant()], 'general')();
    expect(service.snapshot().trackedScopes).toBe(2);
  });
  it('bounds streams and costly work while leaving ordinary shop reads available', () => {
    const service = fixture();
    const streams = Array.from({ length: 8 }, () =>
      service.acquire(tenant(), 'stream'),
    );
    expect(() => service.acquire(tenant(), 'stream')).toThrow(
      FairnessLimitedException,
    );
    const reports = Array.from({ length: 8 }, () =>
      service.acquire(tenant(), 'expensive'),
    );
    expect(() => service.acquire(tenant(), 'expensive')).toThrow(
      FairnessLimitedException,
    );
    service.acquire(tenant(), 'general')();
    [...streams, ...reports].forEach((release) => release());
  });
  it('bounds identity storage and reclaims idle buckets only after refill', () => {
    vi.useFakeTimers();
    const service = fixture({ API_FAIR_MAX_SCOPES: 2 });
    service.acquire(tenant('a'), 'general')();
    service.acquire(tenant('b'), 'general')();
    expect(() => service.acquire(tenant('new'), 'general')).toThrow();
    expect(service.snapshot()).toMatchObject({
      trackedScopes: 2,
      capacityRejected: 1,
    });
    service.acquire([], 'health')();
    vi.advanceTimersByTime(120001);
    service.acquire(tenant('new'), 'general')();
    expect(service.snapshot().trackedScopes).toBe(1);
  });
  it('holds fairness capacity until disconnected underlying work settles', async () => {
    const service = fixture();
    const work = new RequestWork(vi.fn());
    work.addRelease(service.acquire(tenant(), 'general'));
    let finish!: () => void;
    const result = work
      .run(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .catch(() => {});
    work.close();
    await result;
    expect(service.snapshot().activeScopeLeases).toBe(1);
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.snapshot().activeScopeLeases).toBe(0);
    work.close();
  });
  it('rejects attaching capacity to closed requests without leaking a lease', () => {
    const service = fixture();
    const work = new RequestWork(vi.fn());
    work.close();
    expect(() =>
      work.addRelease(service.acquire(tenant(), 'general')),
    ).toThrow();
    expect(service.snapshot().activeScopeLeases).toBe(0);
  });
  it('uses verified context, normalizes UUIDs and isolates public/private lanes', () => {
    expect(fairnessScopes({ params: { shopId: 'A' } })).toEqual([]);
    expect(
      fairnessScopes({
        params: { shopId: 'A' },
        user: { id: 'u' },
        shopMembership: { shopId: 'a' },
      }),
    ).toEqual([...account('u'), ...tenant('a')]);
    expect(fairnessScopes({ params: { shopSlug: 'a' } })).toEqual([
      { key: 'public:a', kind: 'tenant' },
    ]);
    expect(fairnessScopes({ params: { shopSlug: 'A' } })[0].key).not.toBe(
      'public:invalid',
    );
    expect(
      fairnessScopes({
        params: { shopId: 'foreign' },
        user: { id: 'u' },
        shopMembership: { shopId: 'a' },
      }),
    ).toEqual(account('u'));
  });
  it('exposes aggregate counters without tenant or account identities', () => {
    const service = fixture();
    service.acquire(tenant('secret-shop'), 'general')();
    expect(JSON.stringify(service.snapshot())).not.toContain('secret-shop');
  });
  it.each([
    { API_FAIR_TENANT_IN_FLIGHT: 33 },
    { API_FAIR_ACCOUNT_BURST: 0 },
    { API_FAIR_TENANT_PER_MINUTE: 'bad' },
    { API_FAIR_MAX_SCOPES: 0 },
  ])('rejects unsafe policy %j', (settings) => {
    expect(() => fixture(settings)).toThrow();
  });
});
