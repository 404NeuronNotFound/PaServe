import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { requestSignal } from '../../common/http/request-context.js';
import { ApiOverloadedException } from '../../common/http/api-overloaded.exception.js';

type Waiter = { grant: () => void; cancel: (reason: unknown) => void };

/** Bound public menu DB work before live metadata/version queries. Private routes
 * never enter this queue. Slots remain held until underlying work settles. */
@Injectable()
export class PublicMenuReadGate implements OnModuleDestroy {
  readonly limits = Object.freeze({ active: 4, waiting: 20, waitMs: 1000 });
  private active = 0;
  private readonly waiting: Waiter[] = [];
  private stopped = false;
  private peakActive = 0;
  private peakWaiting = 0;
  private rejected = 0;

  snapshot() {
    return {
      limits: this.limits,
      active: this.active,
      waiting: this.waiting.length,
      peakActive: this.peakActive,
      peakWaiting: this.peakWaiting,
      rejected: this.rejected,
    };
  }
  private busy() {
    this.rejected++;
    return new ApiOverloadedException();
  }
  private slot(): () => void {
    this.active++;
    this.peakActive = Math.max(this.peakActive, this.active);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      if (!this.stopped) this.waiting.shift()?.grant();
    };
  }
  private acquire(): Promise<() => void> {
    const signal = requestSignal();
    signal?.throwIfAborted();
    if (this.stopped) return Promise.reject(this.busy());
    if (this.active < this.limits.active) return Promise.resolve(this.slot());
    if (this.waiting.length >= this.limits.waiting)
      return Promise.reject(this.busy());
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
      };
      const waiter: Waiter = {
        grant: () => {
          cleanup();
          if (signal?.aborted) {
            reject(signal.reason);
            this.waiting.shift()?.grant();
          } else resolve(this.slot());
        },
        cancel: (reason) => {
          cleanup();
          reject(reason);
        },
      };
      const abort = () => waiter.cancel(signal?.reason);
      const timer = setTimeout(
        () => waiter.cancel(this.busy()),
        this.limits.waitMs,
      );
      timer.unref();
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(waiter);
      this.peakWaiting = Math.max(this.peakWaiting, this.waiting.length);
    });
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      requestSignal()?.throwIfAborted();
      return await work();
    } finally {
      release();
    }
  }
  onModuleDestroy() {
    this.stopped = true;
    while (this.waiting.length) this.waiting[0].cancel(this.busy());
  }
}
