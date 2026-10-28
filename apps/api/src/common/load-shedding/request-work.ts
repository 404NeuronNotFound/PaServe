import type { Request } from 'express';
import { ApiOverloadedException } from '../http/api-overloaded.exception.js';
import { RequestTimeoutException } from '../http/request-timeout.exception.js';
import { requestContext } from '../http/request-context.js';

export const REQUEST_WORK = Symbol('paserve:request-work');

/** Retains admission until both the response and underlying work have finished. */
export class RequestWork {
  private pending = 0;
  private closed = false;
  private released = false;
  private readonly controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  readonly signal = this.controller.signal;

  constructor(private readonly release: () => void) {}

  close(): void {
    this.closed = true;
    this.clearDeadline();
    if (!this.signal.aborted)
      this.controller.abort(new ApiOverloadedException());
    this.tryRelease();
  }

  startDeadline(
    ms: number,
    expired: (error: RequestTimeoutException) => void,
  ): void {
    this.timer = setTimeout(() => {
      const error = new RequestTimeoutException();
      this.controller.abort(error);
      expired(error);
    }, ms);
    this.timer.unref();
  }

  clearDeadline(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    if (this.closed) throw new ApiOverloadedException();
    this.pending++;
    const underlying = (async () => {
      try {
        return await requestContext.run(this, work);
      } finally {
        this.pending--;
        this.tryRelease();
      }
    })();
    // Abort the caller's wait, not the capacity reservation or underlying promise.
    let aborted!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      aborted = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', aborted, { once: true });
      if (this.signal.aborted) aborted();
    });
    try {
      return await Promise.race([underlying, cancelled]);
    } finally {
      this.signal.removeEventListener('abort', aborted);
    }
  }

  private tryRelease(): void {
    if (this.closed && this.pending === 0 && !this.released) {
      this.released = true;
      this.release();
    }
  }
}

export type AdmittedRequest = Request & { [REQUEST_WORK]?: RequestWork };

/** Use around asynchronous guard work, which runs before interceptors. */
export function trackRequestWork<T>(request: Request, work: () => Promise<T>) {
  const admission = (request as AdmittedRequest)[REQUEST_WORK];
  return admission ? admission.run(work) : work();
}
