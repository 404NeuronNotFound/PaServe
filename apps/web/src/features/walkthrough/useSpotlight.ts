import { useLayoutEffect, useState, type RefObject } from "react";
import type { TourStep } from "./steps";
export type Spotlight = {
  left: number;
  top: number;
  width: number;
  height: number;
  side: "left" | "right";
  fallback: boolean;
};
function visible(selector: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(
    (element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        !element.closest("[hidden]") &&
        getComputedStyle(element).visibility !== "hidden"
      );
    },
  );
}
export function useSpotlight(
  step: TourStep,
  card: RefObject<HTMLDivElement | null>,
) {
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      const target = step.target ? visible(step.target) : undefined;
      const fallback =
        step.target && !target
          ? visible('[data-walkthrough="workspace-menu"]')
          : undefined;
      const element = target ?? fallback;
      const viewport = window.visualViewport;
      const viewTop = viewport?.offsetTop ?? 0;
      const viewHeight = viewport?.height ?? window.innerHeight;
      const viewWidth = window.innerWidth;
      const box = element?.getBoundingClientRect();
      const cardBox = card.current?.getBoundingClientRect();
      const width = cardBox?.width || Math.min(560, viewWidth - 32);
      const height = cardBox?.height || 310;
      const left =
        viewWidth <= 600 || !box || box.left + box.width / 2 < viewWidth / 2
          ? Math.max(16, viewWidth - width - 24)
          : 24;
      const bottomTop = Math.max(
        viewTop + 16,
        viewTop + viewHeight - height - 24,
      );
      // On narrow screens keep the card on the opposite vertical side of the target.
      const top =
        viewWidth <= 600 &&
        box &&
        box.top + box.height / 2 > viewTop + viewHeight / 2
          ? viewTop + 16
          : bottomTop;
      card.current?.style.setProperty("--keybeen-card-left", left + "px");
      card.current?.style.setProperty("--keybeen-card-top", top + "px");
      if (!box) {
        setSpotlight(null);
        return;
      }
      const x = Math.max(8, box.left - 6);
      const y = Math.max(viewTop + 8, box.top - 6);
      const right = Math.min(viewWidth - 8, box.right + 6);
      const bottom = Math.min(viewTop + viewHeight - 8, box.bottom + 6);
      if (right <= x || bottom <= y) {
        setSpotlight(null);
        return;
      }
      const next: Spotlight = {
        left: x,
        top: y,
        width: right - x,
        height: bottom - y,
        side: box.left + box.width / 2 < left + width / 2 ? "left" : "right",
        fallback: Boolean(fallback),
      };
      setSpotlight((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof Spotlight] === next[key as keyof Spotlight],
        )
          ? previous
          : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const initial = step.target
      ? (visible(step.target) ?? visible('[data-walkthrough="workspace-menu"]'))
      : undefined;
    const initialBox = initial?.getBoundingClientRect();
    if (
      initialBox &&
      (initialBox.top < 0 || initialBox.bottom > window.innerHeight)
    )
      initial?.scrollIntoView({ block: "nearest", inline: "nearest" });
    update();
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    const root = document.querySelector(".dashboard-shell");
    const observer = new MutationObserver(schedule);
    if (root) observer.observe(root, { childList: true, subtree: true });
    const size =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    if (card.current) size?.observe(card.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      size?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [step, card]);
  return spotlight;
}
