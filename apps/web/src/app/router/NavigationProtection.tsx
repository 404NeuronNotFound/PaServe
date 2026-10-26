import { Registry, type Draft } from "./useDraftGuard";
import { useCallback, useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";

export function NavigationProtection({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => new Map());
  const currentDrafts = useRef(new Map<string, Draft>());
  const leaving = useRef(false);
  const register = useCallback((id: string, draft?: Draft) => {
      const next = new Map(currentDrafts.current);
      if (draft) next.set(id, draft); else next.delete(id);
      currentDrafts.current = next;
      setDrafts(next);
  }, []);
  const { dirty, busy } = useMemo(() => ({
    dirty: [...drafts.values()].some((draft) => draft.dirty),
    busy: [...drafts.values()].some((draft) => draft.busy),
  }), [drafts]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    [...currentDrafts.current.values()].some((draft) => draft.dirty || draft.busy) &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => { if (blocker.state === "unblocked") leaving.current = false; }, [blocker.state]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  return <Registry.Provider value={register}>
    {children}
    <DecisionDialog open={blocker.state === "blocked"}
      className="navigation-decision-dialog"
      title={busy ? "Action in progress" : "Leave this page?"}
      description={busy ? "Wait for the current action to finish before leaving. Your work stays here." : "Unsaved changes will be lost. Saved cart items will remain available."}
      confirmLabel={dirty ? "Discard and leave" : "Leave page"}
      confirmDisabled={busy} cancelLabel="Keep editing" destructive={dirty}
      onConfirm={() => { if (!busy && blocker.state === "blocked") { leaving.current = true; blocker.proceed(); } }}
      onClose={() => { if (!leaving.current && blocker.state === "blocked") blocker.reset(); }} />
  </Registry.Provider>;
}
