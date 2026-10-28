import { ConfigService } from '@nestjs/config';
import { RequestDeadlineService } from './request-deadline.service.js';
import { RequestWork } from '../load-shedding/request-work.js';
import { requestSignal } from './request-context.js';

describe('request deadline policy and cancellation accounting', () => {
  it.each(['0', '-1', 'NaN', '99', '120001'])(
    'rejects invalid/unbounded deadlines %s',
    (value) => {
      expect(
        () =>
          new RequestDeadlineService(
            new ConfigService({ API_READ_TIMEOUT_MS: value }),
          ),
      ).toThrow();
    },
  );
  it('selects read/write and explicit expensive/auth/stream/readiness budgets', () => {
    const deadlines = new RequestDeadlineService(new ConfigService());
    expect(deadlines.forRequest('GET')).toBe(15000);
    expect(deadlines.forRequest('POST')).toBe(45000);
    expect(deadlines.forRequest('POST', 'login')).toBe(10000);
    expect(deadlines.forRequest('GET', 'reports')).toBe(30000);
    expect(deadlines.forRequest('POST', 'upload')).toBe(30000);
    expect(deadlines.forRequest('GET', 'stream')).toBe(10000);
    expect(deadlines.forRequest('GET', undefined, true)).toBe(3000);
  });
  it('propagates abort through async context while retaining non-cancellable work', async () => {
    const release = vi.fn();
    const expired = vi.fn();
    const work = new RequestWork(release);
    let finish!: () => void;
    const underlying = work.run(async () => {
      expect(requestSignal()).toBe(work.signal);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      expect(requestSignal()?.aborted).toBe(true);
    });
    const result = underlying.catch((error: unknown) => error);
    work.startDeadline(10, expired);
    await result;
    expect(expired).toHaveBeenCalledTimes(1);
    work.close();
    expect(release).not.toHaveBeenCalled();
    finish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(release).toHaveBeenCalledTimes(1);
    expect(requestSignal()).toBeUndefined();
  });
});
