import { useState, type SetStateAction } from "react";

/** Change query and cursor together, without requesting an old page for a new term. */
export function useOrderListSearch() {
  const [state, setState] = useState({
    search: "",
    cursors: [null] as (string | null)[],
  });
  const setCursors = (value: SetStateAction<(string | null)[]>) =>
    setState((current) => ({
      ...current,
      cursors: typeof value === "function" ? value(current.cursors) : value,
    }));
  const applySearch = (search: string) => setState({ search, cursors: [null] });
  return { ...state, setCursors, applySearch };
}
