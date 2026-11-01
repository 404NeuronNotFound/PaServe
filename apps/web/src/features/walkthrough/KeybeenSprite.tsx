import { useId } from "react";
import type { KeybeenPose } from "./steps";
const frames: Record<KeybeenPose, { x: number; width: number }> = {
  wave: { x: 0, width: 414 },
  left: { x: 430, width: 470 },
  right: { x: 970, width: 470 },
  think: { x: 1440, width: 335 },
  done: { x: 1810, width: 362 },
};
export function KeybeenSprite({ pose }: { pose: KeybeenPose }) {
  const frame = frames[pose];
  const clipId = useId();
  return (
    <svg
      className="keybeen-character"
      viewBox={frame.x + " 0 " + frame.width + " 724"}
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      data-pose={pose}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={frame.x} y="0" width={frame.width} height="724" />
        </clipPath>
      </defs>
      <image
        clipPath={`url(#${clipId})`}
        href="/images/keybeen/keybeen-poses.webp"
        width="2172"
        height="724"
      />
    </svg>
  );
}
