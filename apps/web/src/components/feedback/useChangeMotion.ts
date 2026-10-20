import { useEffect, useRef } from "react";

type ChangeMotion = "count" | "price" | "queue";
const frames: Record<ChangeMotion, Keyframe[]> = {
  count: [{ transform: "scale(1)" }, { transform: "scale(1.12)", offset: 0.4 }, { transform: "scale(1)" }],
  price: [{ transform: "translateY(2px)" }, { transform: "translateY(0)" }],
  queue: [{ boxShadow: "inset 0 0 0 2px var(--color-muted)" }, { boxShadow: "inset 0 0 0 0 transparent" }],
};

/** A cue for an actual value change. Never delays a write, dismissal or focus. */
export function useChangeMotion<T extends HTMLElement>(value: string | number, kind: ChangeMotion) {
  const ref = useRef<T>(null);
  const previous = useRef(value);
  useEffect(() => {
    const changed = !Object.is(previous.current, value);
    previous.current = value;
    const node = ref.current;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!changed || !node?.animate || preference?.matches || document.hidden) return;
    let animation: Animation;
    try {
      animation = node.animate(frames[kind], {
        duration: kind === "queue" ? 260 : 180,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    } catch {
      // The saved value remains visible when motion is unsupported.
      return;
    }
    const stop = () => animation.cancel();
    const visibility = () => { if (document.hidden) stop(); };
    if (preference?.addEventListener) preference.addEventListener("change", stop);
    else preference?.addListener?.(stop);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      if (preference?.removeEventListener) preference.removeEventListener("change", stop);
      else preference?.removeListener?.(stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [value, kind]);
  return ref;
}
