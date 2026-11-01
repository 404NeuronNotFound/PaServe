import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KeybeenSprite } from "./KeybeenSprite";
import type { KeybeenPose } from "./steps";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("starts talking and gesturing after image load, blinks, then returns to idle", () => {
  vi.useFakeTimers();
  const { container } = render(
    <KeybeenSprite pose="wave" speech="Quick guide lang tayo." />,
  );
  const sprite = container.querySelector("svg")!;
  const image = container.querySelector("image")!;
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.load(image);
  act(() => vi.advanceTimersByTime(100));
  expect(sprite).toHaveAttribute("data-frame", "2");
  expect(image).toHaveAttribute("y", "-768");
  act(() => vi.advanceTimersByTime(100));
  expect(sprite).toHaveAttribute("data-frame", "1");
  act(() => vi.advanceTimersByTime(1700));
  expect(sprite).toHaveAttribute("data-frame", "3");
  act(() => vi.advanceTimersByTime(800));
  expect(sprite).toHaveAttribute("data-frame", "0");
  act(() => vi.advanceTimersByTime(3500));
  expect(sprite).toHaveAttribute("data-frame", "3");
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
});

it("falls back to the original intact pose if the animation image fails", () => {
  const { container } = render(<KeybeenSprite pose="done" speech="Ready!" />);
  fireEvent.error(container.querySelector("image")!);
  expect(container.querySelector("image")).toHaveAttribute(
    "href",
    "/images/keybeen/keybeen-poses.webp",
  );
  expect(container.querySelector("image")).toHaveAttribute("x", "-1810");
  expect(container.querySelector("mask")).not.toBeInTheDocument();
});
it.each(["wave", "left", "right", "think", "done"] as KeybeenPose[])(
  "renders %s as one intact sprite with a breathing wrapper",
  (pose) => {
    const { container } = render(<KeybeenSprite pose={pose} />);
    expect(container.querySelector("svg")).toHaveAttribute("data-pose", pose);
    expect(container.querySelectorAll("image")).toHaveLength(1);
    expect(container.querySelectorAll("clipPath")).toHaveLength(1);
    expect(
      container.querySelector(
        "mask, .keybeen-hand, .keybeen-mouth, .keybeen-blink",
      ),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".keybeen-breathing > g > image"),
    ).toBeInTheDocument();
    expect(container.querySelector(".keybeen-breathing > g")).toHaveAttribute(
      "clip-path",
    );
  },
);
it("starts still when reduced motion is preferred", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const { container } = render(<KeybeenSprite pose="wave" />);
  expect(container.querySelector("svg")).toHaveAttribute(
    "data-active",
    "false",
  );
});
it("pauses on hidden documents and resumes when visible", () => {
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const { container } = render(<KeybeenSprite pose="think" />);
  expect(container.querySelector("svg")).toHaveAttribute("data-active", "true");
  hidden = true;
  fireEvent(document, new Event("visibilitychange"));
  expect(container.querySelector("svg")).toHaveAttribute(
    "data-active",
    "false",
  );
  hidden = false;
  fireEvent(document, new Event("visibilitychange"));
  expect(container.querySelector("svg")).toHaveAttribute("data-active", "true");
});
