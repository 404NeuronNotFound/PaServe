import { expect, it } from "vitest";
import { menuTheme } from "./menu-theme";
import type { CSSProperties } from "react";

it("keeps brand-label contrast above 4.5:1 across a representative RGB grid and every gray", () => {
  // WCAG 2.2 SC 1.4.3: evaluate the returned colors, not the foreground choice.
  const luminance = (hex: string) => {
    const rgb = hex
      .match(/[a-f0-9]{2}/gi)!
      .map((channel) => parseInt(channel, 16) / 255);
    const linear = rgb.map((value) =>
      value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
    );
    return linear.reduce(
      (total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index],
      0,
    );
  };
  const check = (color: string) => {
    const theme = menuTheme(color) as CSSProperties & Record<string, string>;
    const values = [
      luminance(theme["--menu-primary"]),
      luminance(theme["--menu-on-primary"]),
    ].sort((a, b) => b - a);
    expect(
      (values[0] + 0.05) / (values[1] + 0.05),
      color,
    ).toBeGreaterThanOrEqual(4.5);
  };
  const hex = (channel: number) => channel.toString(16).padStart(2, "0");
  for (let red = 0; red <= 255; red += 17)
    for (let green = 0; green <= 255; green += 17)
      for (let blue = 0; blue <= 255; blue += 17)
        check(`#${hex(red)}${hex(green)}${hex(blue)}`);
  for (let gray = 0; gray <= 255; gray++) check(`#${hex(gray).repeat(3)}`);
});

it("falls back safely for missing and invalid colors", () => {
  for (const color of [null, undefined, "", "red", "#abc", "url(unsafe)"])
    expect(menuTheme(color)).toEqual(menuTheme("#243329"));
});
it("normalizes color and chooses a readable foreground for light and dark brands", () => {
  expect(menuTheme(" #abcdef ")).toEqual({
    "--menu-primary": "#ABCDEF",
    "--menu-on-primary": "#000000",
  });
  expect(menuTheme("#000000")).toEqual({
    "--menu-primary": "#000000",
    "--menu-on-primary": "#FFFFFF",
  });
  expect(menuTheme("#FFFFFF")).toEqual({
    "--menu-primary": "#FFFFFF",
    "--menu-on-primary": "#000000",
  });
});
