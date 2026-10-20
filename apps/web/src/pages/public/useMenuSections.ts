import { useEffect, useState, type RefObject } from "react";

/** Keep navigation and anchor clearance in step with the actual browse-bar size. */
export function useMenuSections(
  sectionIds: string[],
  sections: RefObject<HTMLDivElement | null>,
  browse: RefObject<HTMLDivElement | null>,
) {
  const [active, setActive] = useState("");
  useEffect(() => {
    const container = sections.current;
    const bar = browse.current;
    if (!container || !bar) return;
    let intersection: IntersectionObserver | undefined;
    const visible = new Set<string>();
    function observe() {
      if (!container || !bar) return;
      intersection?.disconnect();
      visible.clear();
      const sticky = getComputedStyle(bar).position === "sticky";
      const offset = sticky ? Math.ceil(bar.getBoundingClientRect().height) + 24 : 24;
      container.style.setProperty("--menu-scroll-offset", `${offset}px`);
      if (typeof IntersectionObserver === "undefined") return;
      intersection = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-menu-section");
          if (!id) continue;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = sectionIds.find((id) => visible.has(id));
        if (first) setActive(first);
      }, { rootMargin: `-${offset}px 0px -35% 0px` });
      for (const section of container.querySelectorAll("[data-menu-section]")) intersection.observe(section);
    }
    observe();
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(observe) : null;
    resize?.observe(bar);
    window.addEventListener("resize", observe);
    return () => {
      resize?.disconnect();
      intersection?.disconnect();
      window.removeEventListener("resize", observe);
      container.style.removeProperty("--menu-scroll-offset");
    };
  }, [sectionIds, sections, browse]);
  return {
    active: sectionIds.includes(active) ? active : sectionIds[0],
    select: setActive,
  };
}
