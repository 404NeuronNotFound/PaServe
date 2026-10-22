import { useEffect, useState } from "react";

/** Display-only clock: inactive views do no timer work; resume uses wall time. */
export function useVisibleNow(enabled = true, intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const update = () => setNow(Date.now());
    const sync = () => {
      window.clearInterval(timer);
      if (document.visibilityState === "hidden") return;
      update();
      timer = window.setInterval(update, intervalMs);
    };
    const initial = window.setTimeout(sync, 0);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled, intervalMs]);
  return now;
}
