/** An impression/turn sequence, not a content entrance. All links remain stationary. */
export function playFooterImpression(footer: HTMLElement): Animation[] {
  const animations: Animation[] = [];
  const run = (
    element: HTMLElement | null,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => {
    if (typeof element?.animate === "function")
      animations.push(element.animate(frames, options));
  };
  footer
    .querySelectorAll<HTMLElement>("[data-footer-letter]")
    .forEach((letter, index) => {
      run(
        letter,
        [
          {
            transform:
              "perspective(900px) rotateY(-48deg) rotateZ(-1deg) scaleX(0.96)",
            offset: 0,
          },
          {
            transform:
              "perspective(900px) rotateY(6deg) rotateZ(0deg) scaleX(1)",
            offset: 0.68,
          },
          {
            transform:
              "perspective(900px) rotateY(0deg) rotateZ(0deg) scaleX(1)",
            offset: 1,
          },
        ],
        {
          duration: 540,
          delay: index * 26,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        },
      );
    });
  run(
    footer.querySelector(".landing-footer-foil"),
    [
      { transform: "translateX(-135%) skewX(-18deg)", opacity: 0, offset: 0 },
      {
        transform: "translateX(-20%) skewX(-18deg)",
        opacity: 0.35,
        offset: 0.4,
      },
      { transform: "translateX(140%) skewX(-18deg)", opacity: 0, offset: 1 },
    ],
    { duration: 720, delay: 70, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
  );
  run(
    footer.querySelector(".landing-footer-rule"),
    [{ transform: "scaleX(0.12)" }, { transform: "scaleX(1)" }],
    { duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
  return animations;
}

/** Native pointer motion is coalesced, mouse-only and capped at four degrees. */
export function bindHeroTilt(
  host: HTMLElement | null,
  preference: MediaQueryList,
) {
  let frame = 0;
  let point: { x: number; y: number } | undefined;
  const reset = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    point = undefined;
    host?.style.setProperty("--pointer-rx", "0deg");
    host?.style.setProperty("--pointer-ry", "0deg");
    host?.style.setProperty("--board-light-opacity", "0");
  };
  const update = () => {
    frame = 0;
    if (!host || !point || preference.matches || document.hidden) return;
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = Math.max(
      -1,
      Math.min(1, ((point.x - box.left) / box.width) * 2 - 1),
    );
    const y = Math.max(
      -1,
      Math.min(1, ((point.y - box.top) / box.height) * 2 - 1),
    );
    host.style.setProperty("--pointer-rx", (-y * 3).toFixed(2) + "deg");
    host.style.setProperty("--pointer-ry", (x * 4).toFixed(2) + "deg");
    host.style.setProperty("--board-light-x", ((x + 1) * 50).toFixed(1) + "%");
    host.style.setProperty("--board-light-opacity", "1");
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || preference.matches || document.hidden)
      return;
    point = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(update);
  };
  host?.addEventListener("pointermove", move, { passive: true });
  host?.addEventListener("pointerleave", reset);
  return {
    reset,
    dispose: () => {
      reset();
      host?.removeEventListener("pointermove", move);
      host?.removeEventListener("pointerleave", reset);
      [
        "--pointer-rx",
        "--pointer-ry",
        "--board-light-opacity",
        "--board-light-x",
      ].forEach((property) => host?.style.removeProperty(property));
    },
  };
}
