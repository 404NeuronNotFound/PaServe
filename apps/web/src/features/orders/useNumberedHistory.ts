import { useRef, useState } from "react";
import type { HistoryPageRequest, HistoryPagination } from "@paserve/contracts";

/** Snapshot lives only in memory; a new filter scope or explicit refresh starts a fresh view. */
export function useNumberedHistory(scope: string) {
  const [selection, setSelection] = useState({ scope, page: 1, version: 0 });
  const current =
    selection.scope === scope
      ? selection
      : { scope, page: 1, version: selection.version + 1 };
  if (selection.scope !== scope) setSelection(current);
  const version = current.version;
  // Retain only the active view. Search/filter/refresh versions must not grow
  // an unbounded history of snapshots during a long-running staff session.
  const snapshot = useRef<{ key: string; value?: string } | undefined>(
    undefined,
  );
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
      if (snapshot.current?.key !== snapshotKey)
        snapshot.current = { key: snapshotKey };
      const entry = snapshot.current;
      const data = await read({
        page: current.page,
        ...(entry.value ? { snapshot: entry.value } : {}),
      });
      // A superseded request may still settle after the next view has loaded.
      if (data.pagination && snapshot.current === entry)
        entry.value = data.pagination.snapshot;
      return data;
    },
  };
}
