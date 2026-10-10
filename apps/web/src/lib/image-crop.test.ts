import { expect, it } from "vitest";
import { cropRectangle } from "./image-crop";
it.each([1, 3])(
  "keeps a %s:1 crop inside landscape, portrait and square sources at every edge",
  (ratio) => {
    for (const [width, height] of [
      [1200, 400],
      [400, 1200],
      [500, 500],
    ])
      for (const zoom of [1, 2, 4])
        for (const x of [0, 50, 100])
          for (const y of [0, 50, 100]) {
            const crop = cropRectangle(width, height, ratio, zoom, x, y);
            expect(crop.width / crop.height).toBeCloseTo(ratio);
            expect(crop.x).toBeGreaterThanOrEqual(0);
            expect(crop.y).toBeGreaterThanOrEqual(0);
            expect(crop.x + crop.width).toBeLessThanOrEqual(width + 1e-7);
            expect(crop.y + crop.height).toBeLessThanOrEqual(height + 1e-7);
          }
  },
);
