import type { Request } from 'express';
import { ApiOverloadedException } from '../http/api-overloaded.exception.js';

export const REQUEST_WORK = Symbol('paserve:request-work');

/** Retains admission until both the response and underlying work have finished. */
export class RequestWork {
  private pending = 0;
  private closed = false;
  private released = false;

  constructor(private readonly release: () => void) {}

  close(): void {
    this.closed = true;
    this.tryRelease();
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) throw new ApiOverloadedException();
    this.pending++;
    try {
      return await work();
    } finally {
      this.pending--;
      this.tryRelease();
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
