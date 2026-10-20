import { useEffect } from "react";

// VisualViewport follows the on-screen keyboard on browsers where dvh does not.
// Keep pinch zoom native: don't reflow the app to the magnified viewport.
export function ViewportLayout() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const previousHeight = root.style.getPropertyValue("--app-viewport-height");
    const previousTop = root.style.getPropertyValue("--app-viewport-top");
    const previousShort = root.getAttribute("data-short-viewport");
    const update = () => {
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      if (!Number.isFinite(height) || height <= 0) return;
      root.style.setProperty("--app-viewport-height", `${height}px`);
      root.style.setProperty("--app-viewport-top", `${Math.max(0, viewport?.offsetTop ?? 0)}px`);
      root.toggleAttribute("data-short-viewport", height <= 540);
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      if (previousHeight) root.style.setProperty("--app-viewport-height", previousHeight);
      else root.style.removeProperty("--app-viewport-height");
      if (previousTop) root.style.setProperty("--app-viewport-top", previousTop);
      else root.style.removeProperty("--app-viewport-top");
      if (previousShort === null) root.removeAttribute("data-short-viewport");
      else root.setAttribute("data-short-viewport", previousShort);
    };
  }, []);
  return null;
}
