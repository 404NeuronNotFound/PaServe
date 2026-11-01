import { expect, it } from "vitest";
import { scrollRevealProgress } from "./scroll-reveals";

it("scrubs the same reveal forward and backward through a reading window", () => {
  const positions = [1000, 900, 800, 600, 300, 0, -150, -300];
  const down = positions.map((top) => scrollRevealProgress(top, top + 200, 1000));
  const up = [...positions].reverse().map((top) => scrollRevealProgress(top, top + 200, 1000));
  expect(up).toEqual([...down].reverse());
  expect(down[0]).toBe(0);
  expect(down[2]).toBeGreaterThan(down[1]);
  expect(down[3]).toBe(1);
  expect(down[4]).toBe(1);
  expect(down.at(-1)).toBe(0);
});

it("keeps long panels fully readable and invalid geometry static", () => {
  expect(scrollRevealProgress(-400, 1200, 1000)).toBe(1);
  expect(scrollRevealProgress(0, 0, 1000)).toBe(1);
  expect(scrollRevealProgress(0, 200, 0)).toBe(1);
});

it("finishes visible footer text even when the document cannot scroll any further", () => {
  expect(scrollRevealProgress(940, 980, 1000, 0, 0)).toBe(1);
  expect(scrollRevealProgress(940, 980, 1000, 0, 200)).toBeLessThan(1);
});
