/** Cookies are shared by tabs; rotating them must be serialized across tabs too. */
export function withSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("paserve:session-cookie", operation);
  }
  // Older browsers retain the existing per-tab refresh deduplication.
  return operation();
}
