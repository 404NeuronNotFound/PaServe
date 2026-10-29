/** Independent reads start together and share cancellation and a total deadline. */
export async function readTogether<T extends readonly unknown[]>(
  reads: { [K in keyof T]: (signal: AbortSignal) => Promise<T[K]> },
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason);
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return (await Promise.all(
      reads.map((read) =>
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return read(controller.signal);
        }),
      ),
    )) as unknown as T;
  } finally {
    // Also stop unfinished siblings after a failed read; preserve its error.
    controller.abort();
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}

/** Bound background fan-out without serializing every independent read. */
export async function mapConcurrentReads<T, R>(
  items: readonly T[],
  read: (item: T) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) {
        signal.throwIfAborted();
        const index = next++;
        results[index] = await read(items[index]);
        signal.throwIfAborted();
      }
    }),
  );
  return results;
}
