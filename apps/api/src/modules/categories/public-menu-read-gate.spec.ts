import { PublicMenuReadGate } from './public-menu-read-gate.js';
import { requestContext } from '../../common/http/request-context.js';

function hold() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('bounded public menu database admission', () => {
  it('admits four, queues at most twenty and rejects overflow immediately', async () => {
    const gate = new PublicMenuReadGate();
    const held = hold();
    const work = Array.from({ length: 24 }, () => gate.run(() => held.promise));
    expect(gate.snapshot()).toMatchObject({ active: 4, waiting: 20 });
    await expect(gate.run(async () => 1)).rejects.toMatchObject({
      status: 503,
      retryAfter: 1,
    });
    held.release();
    await Promise.all(work);
    expect(gate.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      peakActive: 4,
      peakWaiting: 20,
      rejected: 1,
    });
  });

  it('removes disconnected queued requests without starting their DB work', async () => {
    const gate = new PublicMenuReadGate(),
      held = hold();
    const active = Array.from({ length: 4 }, () =>
      gate.run(() => held.promise),
    );
    const controller = new AbortController(),
      work = vi.fn(async () => 1);
    const queued = requestContext.run({ signal: controller.signal }, () =>
      gate.run(work),
    );
    const rejected = expect(queued).rejects.toThrow('disconnected');
    controller.abort(new Error('disconnected'));
    await rejected;
    expect(work).not.toHaveBeenCalled();
    expect(gate.snapshot()).toMatchObject({ active: 4, waiting: 0 });
    held.release();
    await Promise.all(active);
  });

  it('retains an active slot until underlying work settles even after disconnect', async () => {
    const gate = new PublicMenuReadGate(),
      held = hold(),
      controller = new AbortController();
    const work = vi.fn(() => held.promise);
    const running = requestContext.run({ signal: controller.signal }, () =>
      gate.run(work),
    );
    await Promise.resolve();
    expect(work).toHaveBeenCalledOnce();
    controller.abort();
    expect(gate.snapshot().active).toBe(1);
    held.release();
    await running;
    expect(gate.snapshot().active).toBe(0);
  });

  it('times out queued admission after one second and cleans up listeners', async () => {
    vi.useFakeTimers();
    const gate = new PublicMenuReadGate(),
      held = hold();
    const active = Array.from({ length: 4 }, () =>
      gate.run(() => held.promise),
    );
    try {
      const queued = gate.run(async () => 1);
      const rejection = expect(queued).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(1000);
      await rejection;
      expect(gate.snapshot().waiting).toBe(0);
    } finally {
      held.release();
      await Promise.all(active);
      vi.useRealTimers();
    }
  });

  it('releases on failure and rejects queued/new work on shutdown', async () => {
    const gate = new PublicMenuReadGate();
    await expect(
      gate.run(async () => {
        throw new Error('query failed');
      }),
    ).rejects.toThrow('query failed');
    expect(gate.snapshot().active).toBe(0);
    const held = hold(),
      active = Array.from({ length: 4 }, () => gate.run(() => held.promise));
    const queued = gate.run(async () => 1);
    const rejection = expect(queued).rejects.toMatchObject({ status: 503 });
    const secondRejection = expect(
      gate.run(async () => 2),
    ).rejects.toMatchObject({ status: 503 });
    gate.onModuleDestroy();
    await Promise.all([rejection, secondRejection]);
    await expect(gate.run(async () => 1)).rejects.toMatchObject({
      status: 503,
    });
    expect(gate.snapshot()).toMatchObject({ active: 4, waiting: 0 });
    held.release();
    await Promise.all(active);
  });
});
