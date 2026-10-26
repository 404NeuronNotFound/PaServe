import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ShopRole } from "@paserve/contracts";
import { useSessionStore } from "./stores/session";
import { announceSignOut } from "./api/session-events";

function containsShop(value: unknown, shopId: string): boolean {
  return (
    value === shopId ||
    (Array.isArray(value)
      ? value.some((v) => containsShop(v, shopId))
      : !!value &&
        typeof value === "object" &&
        Object.values(value).some((v) => containsShop(v, shopId)))
  );
}

export const accessRevalidation = {
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always",
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;
export const ACCESS_FRESH_MS = 90_000;

/** A recent server-verified grant stays usable during a routine refresh. Failed
 * checks still lock immediately; a long-idle or slow check cannot extend it. */
export function useRecentAccess(dataUpdatedAt: number) {
  const [expiredThrough, setExpiredThrough] = useState(0);
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const timer = setTimeout(
      () => {
        setExpiredThrough((previous) => Math.max(previous, dataUpdatedAt));
      },
      Math.max(0, dataUpdatedAt + ACCESS_FRESH_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [dataUpdatedAt]);
  return dataUpdatedAt > expiredThrough;
}
export function useEndRevokedSession(rejected: boolean) {
  useEffect(() => {
    if (rejected) {
      useSessionStore.getState().endSession();
      announceSignOut();
    }
  }, [rejected]);
}
export function useAccessOnline() {
  return useSyncExternalStore(
    (callback) => onlineManager.subscribe(callback),
    () => onlineManager.isOnline(),
  );
}
// Keep a definitive denial latched while its cache is discarded. Scope changes
// start a fresh validation; a cache removal must never restore an old grant.
export function useAccessDenial(scope: string, status?: number) {
  const [denial, setDenial] = useState<{
    scope: string;
    status: number;
  } | null>(null);
  const terminal =
    status !== undefined && [400, 401, 403, 404].includes(status);
  if (terminal && (denial?.scope !== scope || denial.status !== status))
    setDenial({ scope, status });
  return terminal
    ? status
    : denial?.scope === scope
      ? denial.status
      : undefined;
}
/** Run after restricted components have unmounted, releasing draft blockers.
 * Await cancellation so late read results cannot repopulate discarded caches. */
export function useDiscardAccessCache(
  client: QueryClient,
  denied: boolean,
  shopId?: string,
) {
  useEffect(() => {
    if (!denied) return;
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        shopId ? containsShop(query.queryKey, shopId) : true,
    };
    void client
      .cancelQueries(filters)
      .then(() => client.removeQueries(filters));
  }, [client, denied, shopId]);
}

export function useDiscardRoleData(
  client: QueryClient,
  scope: string,
  shopId: string,
  role?: ShopRole,
) {
  const previous = useRef<{ scope: string; role: ShopRole } | null>(null);
  useEffect(() => {
    if (!role) return;
    const changed =
      previous.current?.scope === scope && previous.current.role !== role;
    previous.current = { scope, role };
    if (!changed) return;
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        containsShop(query.queryKey, shopId) &&
        query.queryKey.at(-1) !== "membership" &&
        query.queryKey[1] !== "access",
    };
    void client
      .cancelQueries(filters)
      .then(() => client.removeQueries(filters));
  }, [client, scope, shopId, role]);
}
