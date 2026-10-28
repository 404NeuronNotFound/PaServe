import { ConfigService } from '@nestjs/config';
import { ApiCapacityService } from './api-capacity.service.js';
import { RequestWork } from './request-work.js';

describe('API capacity bounds', () => {
  it.each(['0', '1', '2', '-1', 'NaN', '1.5', '4097', ''])(
    'rejects unsafe total capacity %s at startup',
    (value) => {
      expect(
        () =>
          new ApiCapacityService(
            new ConfigService({ API_MAX_IN_FLIGHT: value }),
          ),
      ).toThrow();
    },
  );
  it.each([
    'API_MAX_IN_FLIGHT_PER_IP',
    'API_MAX_AUTH_IN_FLIGHT',
    'API_MAX_STREAMS',
    'API_MAX_EXPENSIVE_IN_FLIGHT',
  ])('requires %s to leave capacity for other traffic', (key) => {
    expect(
      () =>
        new ApiCapacityService(
          new ConfigService({ API_MAX_IN_FLIGHT: '4', [key]: '4' }),
        ),
    ).toThrow();
  });
  it('keeps rejection state bounded, removes idle clients and releases only once', () => {
    const capacity = new ApiCapacityService(
      new ConfigService({ API_MAX_IN_FLIGHT: '4', API_RESERVED_CRITICAL: '1' }),
    );
    const one = capacity.acquire('one', 'general');
    const two = capacity.acquire('two', 'general');
    for (let index = 0; index < 1000; index++) {
      expect(() => capacity.acquire(`rejected-${index}`, 'general')).toThrow();
    }
    expect(capacity.snapshot().trackedClients).toBe(2);
    expect(capacity.snapshot().rejected.reserved).toBe(1000);
    one();
    one();
    two();
    expect(capacity.snapshot().active.total).toBe(0);
    expect(capacity.snapshot().trackedClients).toBe(0);
    expect(capacity.snapshot().completed).toBe(2);
  });
  it('keeps a lease through work rejection and rejects new work after close', async () => {
    const release = vi.fn();
    const lease = new RequestWork(release);
    let fail!: (error: Error) => void;
    const pending = lease.run(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    const outcome = pending.catch((error: unknown) => error);
    lease.close();
    lease.close();
    expect(release).not.toHaveBeenCalled();
    const next = vi.fn();
    await expect(lease.run(next)).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
    fail(new Error('fixture failure'));
    expect(await outcome).toBeInstanceOf(Error);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(release).toHaveBeenCalledTimes(1);
  });
  it.each([
    { API_MAX_IN_FLIGHT: '4', API_RESERVED_CRITICAL: '3' },
    { API_RESERVED_CRITICAL: '0' },
    { API_MAX_IN_FLIGHT_PER_IP: '1' },
    { API_MAX_IN_FLIGHT_PER_IP: '3', API_RESERVED_CRITICAL_PER_IP: '3' },
    { API_RESERVED_CRITICAL_PER_IP: '0' },
  ])('rejects reserve settings that eliminate safety headroom', (settings) => {
    expect(() => new ApiCapacityService(new ConfigService(settings))).toThrow();
  });
  it('protects reserves from a mixture of ordinary workloads, not just general requests', () => {
    const capacity = new ApiCapacityService(
      new ConfigService({ API_MAX_IN_FLIGHT: '8', API_RESERVED_CRITICAL: '2' }),
    );
    const releases = [
      capacity.acquire('a', 'general'),
      capacity.acquire('b', 'auth'),
      capacity.acquire('c', 'stream'),
      capacity.acquire('d', 'expensive'),
      capacity.acquire('e', 'general'),
    ];
    expect(() => capacity.acquire('f', 'auth')).toThrow();
    releases.push(
      capacity.acquire('g', 'critical'),
      capacity.acquire('h', 'critical'),
    );
    expect(() => capacity.acquire('i', 'critical')).toThrow();
    releases.push(capacity.acquire('probe', 'health'));
    expect(capacity.snapshot().active.total).toBe(8);
    releases.forEach((release) => release());
    expect(capacity.snapshot().trackedClients).toBe(0);
  });
});
