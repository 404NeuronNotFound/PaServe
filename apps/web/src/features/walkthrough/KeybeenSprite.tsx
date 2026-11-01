import { useEffect, useId, useRef, useState } from "react";
import type { KeybeenPose } from "./steps";
import { KEYBEEN_ATLAS } from "./keybeen-atlas";
import { explanationDuration, keybeenRowAt } from "./keybeen-animation";
import "./keybeen-motion.css";

const originalFrames: Record<KeybeenPose, { x: number; width: number }> = {
  wave: { x: 0, width: 414 },
  left: { x: 430, width: 470 },
  right: { x: 970, width: 470 },
  think: { x: 1440, width: 335 },
  done: { x: 1810, width: 362 },
};
function motionAllowed() {
  return (
    !document.hidden &&
    !(
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
  );
}

/** Swap complete registered drawings; breathing never separates body parts. */
export function KeybeenSprite({
  pose,
  speech = "",
}: {
  pose: KeybeenPose;
  speech?: string;
}) {
  const clipId = useId();
  const [active, setActive] = useState(motionAllowed);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [row, setRow] = useState<0 | 1 | 2 | 3>(0);
  const clock = useRef<{ text: string; start: number } | null>(null);
  useEffect(() => {
    if (!active || !ready || failed) return;
    if (!clock.current || clock.current.text !== speech)
      clock.current = { text: speech, start: Date.now() };
    const start = clock.current.start;
    const duration = explanationDuration(speech);
    const timer = window.setInterval(() => {
      const next = keybeenRowAt(Date.now() - start, duration);
      setRow((previous) => (previous === next ? previous : next));
    }, 100);
    return () => clearInterval(timer);
  }, [active, ready, failed, speech]);
  useEffect(() => {
    const preference =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : undefined;
    const update = () => setActive(!document.hidden && !preference?.matches);
    document.addEventListener("visibilitychange", update);
    preference?.addEventListener("change", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      preference?.removeEventListener("change", update);
    };
  }, []);
  const frame = failed ? originalFrames[pose] : KEYBEEN_ATLAS.frames[pose];
  const height = failed ? 724 : KEYBEEN_ATLAS.frameHeight;
  const visibleRow = active && ready && !failed ? row : 0;
  return (
    <svg
      className="keybeen-character"
      viewBox={`0 0 ${frame.width} ${height}`}
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      data-pose={pose}
      data-active={active}
      data-frame={visibleRow}
      data-ready={ready && !failed}
    >
      <defs>
        <clipPath id={clipId}>
          <rect width={frame.width} height={height} />
        </clipPath>
      </defs>
      <g className="keybeen-breathing">
        <g clipPath={`url(#${clipId})`}>
          <image
            href={
              failed
                ? "/images/keybeen/keybeen-poses.webp"
                : "/images/keybeen/keybeen-animated.png"
            }
            x={-frame.x}
            y={-visibleRow * height}
            width={failed ? 2172 : KEYBEEN_ATLAS.width}
            height={failed ? 724 : KEYBEEN_ATLAS.height}
            onLoad={() => setReady(true)}
            onError={() => setFailed(true)}
          />
        </g>
      </g>
    </svg>
  );
}
