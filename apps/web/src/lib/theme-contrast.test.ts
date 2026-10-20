// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const themeCss = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const baseCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function tokens(selector: string, css: string) {
  const block = css.slice(css.indexOf(selector) + selector.length).split("}")[0];
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]+)/gi)].map((match) => [match[1], match[2]]));
}
function contrast(a: string, b: string) {
  const luminance = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + 0.05) / (dark + 0.05);
}
it.each(["day", "night"])("keeps %s theme text, focus and control boundaries readable on shared surfaces", (mode) => {
  const palette = {
    ...tokens(":root {", baseCss),
    ...tokens(":root {", themeCss),
    ...(mode === "night" ? tokens(':root[data-appearance="night"] {', themeCss) : {}),
  };
  for (const surface of ["canvas", "surface", "secondary"]) {
    const background = palette[`--color-${surface}`];
    for (const text of ["text", "muted"])
      expect(contrast(palette[`--color-${text}`], background), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    for (const control of ["focus", "control-border"])
      expect(contrast(palette[`--color-${control}`], background), `${control} on ${surface}`).toBeGreaterThanOrEqual(3);
  }
  expect(contrast(palette["--color-error"], palette["--color-error-surface"])).toBeGreaterThanOrEqual(4.5);
});
