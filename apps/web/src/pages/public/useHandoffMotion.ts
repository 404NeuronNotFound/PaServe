import { useEffect, useRef, type RefObject } from "react";

/** Let a changed handoff pivot like a paper docket, without delaying its status. */
export function useHandoffMotion(
  board: RefObject<HTMLDivElement | null>,
  stage: number,
) {
  const previous = useRef(stage);
  useEffect(() => {
    if (previous.current === stage) return;
    const direction = stage > previous.current ? -1 : 1;
    previous.current = stage;
    const face = board.current?.querySelector<HTMLElement>(
      ".landing-board-body",
    );
    if (
      !face ||
      typeof face.animate !== "function" ||
      typeof window.matchMedia !== "function" ||
      document.hidden
    )
      return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches) return;
    const animation = face.animate(
      [
        {
          transform:
            "perspective(1100px) rotateY(" +
            direction * 5 +
            "deg) scale(0.993)",
        },
        { transform: "perspective(1100px) rotateY(0deg) scale(1)" },
      ],
      { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    const cancel = () => animation.cancel();
    const hidden = () => {
      if (document.hidden) cancel();
    };
    preference.addEventListener("change", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel();
      preference.removeEventListener("change", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [board, stage]);
}
