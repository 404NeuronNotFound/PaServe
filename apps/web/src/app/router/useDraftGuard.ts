import { createContext, useContext, useLayoutEffect, useId } from "react";
export type Draft = { dirty: boolean; busy: boolean };
export const Registry = createContext<((id: string, draft?: Draft) => void) | null>(null);

/** Register only unsaved data, not saved carts or read-only filters. */
export function useDraftGuard(dirty: boolean, busy = false) {
  const register = useContext(Registry);
  const id = useId();
  useLayoutEffect(() => {
    register?.(id, { dirty, busy });
    return () => register?.(id);
  }, [id, dirty, busy, register]);
  return { protected: register !== null, release: () => register?.(id, { dirty: false, busy: false }) };
}

