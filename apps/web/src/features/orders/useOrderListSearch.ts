import { useState, type SetStateAction } from "react";
import type { OwnerOrderFilters } from "@paserve/contracts";

/** Change query and cursor together, without requesting an old page for a new term. */
export function useOrderListSearch() {
  const [state, setState] = useState({
    search: "",
    filters: {} as OwnerOrderFilters,
    cursors: [null] as (string | null)[],
    resetVersion: 0,
  });
  const setCursors = (value: SetStateAction<(string | null)[]>) =>
    setState((current) => ({
      ...current,
      cursors: typeof value === "function" ? value(current.cursors) : value,
    }));
  const applySearch = (search: string) =>
    setState((current) => ({ ...current, search, cursors: [null] }));
  const applyFilters = (filters: OwnerOrderFilters) =>
    setState((current) => ({ ...current, filters, cursors: [null] }));
  return {
    ...state,
    setCursors,
    applySearch,
    applyFilters,
    clearAll: () => setState((current) => ({
      search: "", filters: {}, cursors: [null], resetVersion: current.resetVersion + 1,
    })),
    hasFilters: Object.keys(state.filters).length > 0,
  };
}
