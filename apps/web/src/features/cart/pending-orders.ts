type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function createPendingOrderStorage(
  storage: () => PendingStorage | null,
) {
  const memory = new Map<string, string | null>();
  return {
    read(key: string): string | null {
      if (memory.has(key)) return memory.get(key) ?? null;
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key: string, value: unknown): void {
      const serialized = JSON.stringify(value);
      memory.set(key, serialized);
      try {
        storage()?.setItem(key, serialized);
      } catch {
        /* The open page retains the original request. */
      }
    },
    remove(key: string): void {
      // Remember removal even if storage is unavailable, so stale data cannot revive.
      memory.set(key, null);
      try {
        storage()?.removeItem(key);
      } catch {
        /* The memory tombstone remains authoritative in this page. */
      }
    },
    clearMemory(): void {
      memory.clear();
    },
  };
}
export const pendingOrders = createPendingOrderStorage(() => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
});
