import { useEffect, type RefObject } from "react";
import { bindHeroTilt, playFooterImpression } from "./landing-animation";
import { collectScrollReveals, playScrollReveal, scrollRevealProgress } from "./scroll-reveals";
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Scroll changes presentation only; content and navigation stay usable without JS motion. */
export function useLandingMotion(
  root: RefObject<HTMLDivElement | null>,
  onChapter: (chapter: number) => void,
) {
  useEffect(() => {
    const page = root.current;
    if (
      !page ||
      typeof window.matchMedia !== "function" ||
      typeof requestAnimationFrame !== "function"
    )
      return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hero = page.querySelector<HTMLElement>(".landing-hero");
    const story = page.querySelector<HTMLElement>(".landing-scroll-story");
    const chapters = [
      ...page.querySelectorAll<HTMLElement>("[data-service-chapter]"),
    ];
    const footer = page.querySelector<HTMLElement>(".landing-footer");
    const tilt = bindHeroTilt(
      page.querySelector(".landing-hero-board-wrap"),
      preference,
    );
    const animations = new Set<Animation>();
    const footerAnimations = new Set<Animation>();
    const revealTimelines = new Map<HTMLElement, { animation: Animation; progress: number | undefined }>();
    let footerArmed = true;
    let footerVisits = 0;
    let heroFollow = 0;
    let lastTick = 0;
    const track = (animation: Animation, footerSequence = false) => {
      animations.add(animation);
      if (footerSequence) footerAnimations.add(animation);
      animation.addEventListener(
        "finish",
        () => {
          animations.delete(animation);
          footerAnimations.delete(animation);
        },
        { once: true },
      );
    };
    const replayFooter = () => {
      if (!footer) return;
      footerAnimations.forEach((animation) => {
        animation.cancel();
        animations.delete(animation);
      });
      footerAnimations.clear();
      const sequence = playFooterImpression(footer);
      if (!sequence.length) return;
      sequence.forEach((animation) => track(animation, true));
      footer.dataset.footerVisit = String(++footerVisits);
    };
    let frame = 0;
    let disposed = false;
    let lastChapter = -1;
    let observer: IntersectionObserver | undefined;
    let contentObserver: MutationObserver | undefined;
    const update = (timestamp = performance.now()) => {
      frame = 0;
      if (disposed || document.hidden) return;
      const viewport = window.innerHeight;
      const height = document.documentElement.scrollHeight - viewport;
      const reading = height > 0 ? clamp(window.scrollY / height) : 0;
      const heroBox = hero?.getBoundingClientRect();
      const storyBox = story?.getBoundingClientRect();
      const footerBox = footer?.getBoundingClientRect();
      const chapterBoxes = chapters.map((chapter) =>
        chapter.getBoundingClientRect(),
      );
      const revealBoxes = [...revealTimelines].map(([element, timeline]) => ({
        element, timeline, box: element.getBoundingClientRect(),
      }));
      const heroProgress = heroBox?.height
        ? clamp(-heroBox.top / heroBox.height)
        : 0;
      const delta = lastTick
        ? Math.min(64, Math.max(1, timestamp - lastTick))
        : 16.67;
      lastTick = timestamp;
      let revealSettling = false;
      revealBoxes.forEach(({ element, timeline, box }) => {
        const target = element.matches(":focus-within") ? 1 : scrollRevealProgress(
          box.top, box.bottom, viewport, Number(element.dataset.revealDelay) || 0, height - window.scrollY,
        );
        const next = timeline.progress === undefined ? target : timeline.progress + (target - timeline.progress) * (1 - Math.exp(-delta / 65));
        timeline.progress = Math.abs(target - next) < 0.002 ? target : next;
        timeline.animation.currentTime = timeline.progress * 1000;
        if (Math.abs(target - timeline.progress) >= 0.002) revealSettling = true;
      });
      heroFollow = preference.matches
        ? heroProgress
        : heroFollow +
          (heroProgress - heroFollow) * (1 - Math.exp(-delta / 85));
      if (Math.abs(heroProgress - heroFollow) < 0.0008)
        heroFollow = heroProgress;
      page.style.setProperty("--reading-progress", String(reading));
      page.style.setProperty(
        "--hero-lift",
        preference.matches ? "0px" : (-heroFollow * 24).toFixed(2) + "px",
      );
      page.style.setProperty(
        "--hero-turn",
        preference.matches ? "0deg" : (heroFollow * -3).toFixed(2) + "deg",
      );
      if (
        storyBox?.height &&
        storyBox.top < viewport * 0.75 &&
        storyBox.bottom > viewport * 0.2
      ) {
        let next = 0;
        chapterBoxes.forEach((box, index) => {
          if (box.height > 0 && box.top <= viewport * 0.48) next = index;
        });
        if (next !== lastChapter) {
          lastChapter = next;
          onChapter(next);
        }
        const progress = clamp(
          (viewport * 0.48 - storyBox.top) /
            Math.max(1, storyBox.height - viewport * 0.3),
        );
        story?.style.setProperty("--story-progress", String(progress));
      }
      // Re-arm only after leaving the bottom region, so bounce cannot loop the sequence.
      if (footerBox?.height) {
        const remaining = height - window.scrollY;
        if (remaining > Math.max(240, viewport * 0.28)) footerArmed = true;
        if (
          footerArmed &&
          remaining <= 96 &&
          footerBox.bottom <= viewport + 96 &&
          footerBox.bottom >= viewport * 0.4
        ) {
          footerArmed = false;
          if (!preference.matches) replayFooter();
        }
      }
      if (!preference.matches && (revealSettling || Math.abs(heroProgress - heroFollow) > 0.0008))
        frame = requestAnimationFrame(update);
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(update);
    };
    const cancelAnimations = () => {
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      footerAnimations.clear();
      revealTimelines.clear();
    };
    const observeReveals = () => {
      observer?.disconnect();
      contentObserver?.disconnect();
      cancelAnimations();
      if (preference.matches || typeof IntersectionObserver === "undefined")
        return;
      observer = new IntersectionObserver(
        (entries) => {
          if (disposed || preference.matches || document.hidden) return;
          entries.forEach((entry) => {
            const element = entry.target as HTMLElement;
            if (!entry.isIntersecting) {
              const timeline = revealTimelines.get(element);
              timeline?.animation.cancel();
              if (timeline) animations.delete(timeline.animation);
              revealTimelines.delete(element);
              return;
            }
            if (revealTimelines.has(element)) return;
            const animation = playScrollReveal(element);
            if (animation) {
              track(animation);
              revealTimelines.set(element, { animation, progress: undefined });
            }
          });
          schedule();
        },
        { threshold: 0, rootMargin: "12% 0px 12% 0px" },
      );
      const observed = new WeakSet<HTMLElement>();
      const register = () => {
        revealTimelines.forEach((timeline, element) => {
          if (!element.isConnected) {
            timeline.animation.cancel();
            animations.delete(timeline.animation);
            revealTimelines.delete(element);
          }
        });
        collectScrollReveals(page).forEach((element) => {
          if (!observed.has(element)) {
            observed.add(element);
            observer?.observe(element);
          }
        });
      };
      register();
      // Radix mounts the selected role panel on demand; reveal its new content too.
      if (typeof MutationObserver !== "undefined") {
        contentObserver = new MutationObserver(register);
        contentObserver.observe(page, { childList: true, subtree: true });
      }
    };
    const preferenceChanged = () => {
      tilt.reset();
      observeReveals();
      schedule();
    };
    const visibilityChanged = () => {
      if (document.hidden) {
        tilt.reset();
        cancelAnimations();
        cancelAnimationFrame(frame);
        frame = 0;
      } else { observeReveals(); schedule(); }
    };
    observeReveals();
    schedule();
    page.addEventListener("focusin", schedule);
    page.addEventListener("focusout", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", visibilityChanged);
    preference.addEventListener("change", preferenceChanged);
    const size =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    size?.observe(page);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimations();
      tilt.dispose();
      observer?.disconnect();
      contentObserver?.disconnect();
      size?.disconnect();
      page.removeEventListener("focusin", schedule);
      page.removeEventListener("focusout", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", visibilityChanged);
      preference.removeEventListener("change", preferenceChanged);
      ["--reading-progress", "--hero-lift", "--hero-turn"].forEach((property) =>
        page.style.removeProperty(property),
      );
    };
  }, [root, onChapter]);
}
