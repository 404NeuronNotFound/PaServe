type RevealKind = "heading" | "text" | "depth" | "row" | "rule";

const groups: [string, RevealKind][] = [
  [".landing-hero h1, .landing-role-copy h3, .landing-story-chapter h3, .colophon-statement", "heading"],
  [".landing-eyebrow, .landing-hero-description, .landing-hero-note, .landing-section-heading > p:last-child, .landing-role-copy > p, .landing-menu-statement > p:last-child, .landing-final-content > div > p:last-child, .colophon-description", "text"],
  [".landing-preview, .landing-service-board, .landing-workspace-sample, .landing-details-ledger article, .colophon-maker", "depth"],
  [".landing-hero-actions, .landing-scroll-cue, .landing-role-tabs .ui-tabs-list, .landing-story-controls, .landing-story-status, .landing-chapter-index, .landing-story-chapter h3, .landing-story-chapter > p, .landing-chapter-detail, .landing-role-copy li, .landing-role-copy > a, .landing-faq-list details, .landing-final-actions, .colophon-links > div, .colophon-heading, .colophon-bottom", "row"],
];

/** No hidden CSS state: unsupported APIs, deep links and interrupted reveals remain readable. */
export function collectScrollReveals(page: HTMLElement): HTMLElement[] {
  groups.forEach(([selector, kind]) => {
    page.querySelectorAll<HTMLElement>(selector).forEach((element, motionIndex) => {
      element.dataset.reveal ??= kind;
      if (kind === "depth") element.dataset.revealSide = motionIndex % 2 === 0 ? "-1" : "1";
      // Stagger only siblings of the same kind. Never queue a long sequence.
      const siblings = element.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-reveal]");
      const index = siblings ? [...siblings].indexOf(element) : 0;
      element.dataset.revealDelay = String(Math.min(3, Math.max(0, index)) * 55);
    });
  });
  return [...page.querySelectorAll<HTMLElement>("[data-reveal]")];
}

export function playScrollReveal(element: HTMLElement): Animation | undefined {
  if (typeof element.animate !== "function" || element.matches(":focus-within")) return;
  const kind = element.dataset.reveal as RevealKind;
  const compact = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 600px)").matches;
  const turn = compact ? 8 : 14;
  const side = Number(element.dataset.revealSide) || -1;
  let frames: Keyframe[];
  if (kind === "rule") {
    frames = [{ transform: "scaleX(0.12)" }, { transform: "scaleX(1)" }];
  } else if (kind === "heading") {
    frames = [
      { clipPath: "inset(0 0 90% 0)", transform: `perspective(1200px) rotateX(${turn + 6}deg) scale(0.97)`, transformOrigin: "50% 100%", opacity: 0.2, offset: 0 },
      { clipPath: "inset(0 0 4% 0)", transform: "perspective(1200px) rotateX(3deg) scale(0.995)", transformOrigin: "50% 100%", opacity: 1, offset: 0.68 },
      { clipPath: "inset(0 0 0% 0)", transform: "perspective(1200px) rotateX(0deg) scale(1)", transformOrigin: "50% 100%", opacity: 1, offset: 1 },
    ];
  } else if (kind === "depth") {
    frames = [
      { transform: `perspective(1400px) rotateX(${turn}deg) rotateY(${side * (compact ? 3 : 6)}deg) scale(${compact ? 0.94 : 0.89})`, transformOrigin: "50% 75%", opacity: 0.3, offset: 0 },
      { transform: `perspective(1400px) rotateX(2deg) rotateY(${side}deg) scale(0.985)`, transformOrigin: "50% 75%", opacity: 1, offset: 0.72 },
      { transform: "perspective(1400px) rotateX(0deg) rotateY(0deg) scale(1)", transformOrigin: "50% 75%", opacity: 1, offset: 1 },
    ];
  } else if (kind === "text") {
    frames = [{ opacity: 0.25, offset: 0 }, { opacity: 0.85, offset: 0.55 }, { opacity: 1, offset: 1 }];
  } else {
    frames = [{ clipPath: "inset(0 20% 0 0)", opacity: 0.25 }, { clipPath: "inset(0 0% 0 0)", opacity: 1 }];
  }
  const animation = element.animate(frames, {
    duration: 1000,
    easing: "linear",
    fill: "both",
  });
  animation.pause?.();
  return animation;
}

/** A symmetric reading window: reversing scroll reverses the same visual state. */
export function scrollRevealProgress(top: number, bottom: number, viewport: number, stagger = 0, remaining = Infinity): number {
  if (viewport <= 0 || bottom <= top) return 1;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const entry = clamp((viewport * 0.98 - top - Math.min(120, stagger * 0.65)) / (viewport * 0.36));
  const exit = clamp((bottom + viewport * 0.06) / (viewport * 0.22));
  let progress = Math.min(entry, exit);
  // The last lines cannot scroll to the centre: let them finish at the document end.
  if (top >= 0 && bottom <= viewport + 24) {
    progress += (1 - progress) * clamp((144 - remaining) / 144);
  }
  return progress * progress * (3 - 2 * progress);
}
