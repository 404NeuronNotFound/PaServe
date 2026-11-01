import { ThrottlerStorageService } from '@nestjs/throttler';
import { ApiOverloadedException } from '../http/api-overloaded.exception.js';

/** Bound distinct-source metadata without evicting a live client's rate budget. */
export class BoundedRateLimitStorage extends ThrottlerStorageService {
  constructor(readonly maximumKeys = 20_000) {
    super();
    if (
      !Number.isInteger(maximumKeys) ||
      maximumKeys < 1 ||
      maximumKeys > 20_000
    )
      throw new Error('Rate-limit key capacity must be between 1 and 20000');
  }

  override async increment(
    ...args: Parameters<ThrottlerStorageService['increment']>
  ): ReturnType<ThrottlerStorageService['increment']> {
    // super.increment installs the key synchronously before returning its
    // promise, so simultaneous new identities cannot overrun this bound.
    if (!this.storage.has(args[0]) && this.storage.size >= this.maximumKeys)
      throw new ApiOverloadedException(60);
    return super.increment(...args);
  }
}
