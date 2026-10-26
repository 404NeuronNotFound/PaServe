import { useRef, useState } from "react";
import type { HistoryPageRequest, HistoryPagination } from "@paserve/contracts";

/** Snapshot lives only in memory; a new filter scope or explicit refresh starts a fresh view. */
export function useNumberedHistory(scope: string) {
  const [selection, setSelection] = useState({ scope, page: 1, version: 0 });
  const current =
    selection.scope === scope ? selection : { scope, page: 1, version: selection.version + 1 };
  if (selection.scope !== scope) setSelection(current);
  const version = current.version;
  const snapshots = useRef(new Map<string, string>());
  const snapshotKey = JSON.stringify([scope, version]);
  const go = (page: number) => setSelection({ scope, page, version });
  return {
    page: current.page,
    key: [current.page, version],
    go,
    refresh: () => setSelection({ scope, page: 1, version: version + 1 }),
    async load<T extends { pagination?: HistoryPagination }>(
      read: (request: HistoryPageRequest) => Promise<T>,
    ) {
      const snapshot = snapshots.current.get(snapshotKey);
      const data = await read({
        page: current.page,
        ...(snapshot ? { snapshot } : {}),
      });
      if (data.pagination) snapshots.current.set(snapshotKey, data.pagination.snapshot);
      return data;
    },
  };
}
