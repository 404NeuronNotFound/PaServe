import type { ReactNode } from "react";

/** Move keyboard focus as well as the viewport, without changing route state. */
export function SkipLink({ targetId, children }: { targetId: string; children: ReactNode }) {
  return <a className="skip-link" href={`#${targetId}`} onClick={(event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start" });
  }}>{children}</a>;
}
