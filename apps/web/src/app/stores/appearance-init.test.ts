// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const bootstrap = readFileSync("public/appearance-init.js", "utf8");
it.each([
  ["day", true, "day"],
  ["night", false, "night"],
  [null, true, "night"],
  [null, false, "day"],
  ["invalid", true, "night"],
  ["blocked", true, "night"],
  [null, "blocked", "day"],
  [null, null, "day"],
] as const)("resolves saved=%s system=%s to %s before React", (saved, dark, expected) => {
  const root = { dataset: {} as Record<string, string> };
  const meta: Record<string, string> = {};
  runInNewContext(bootstrap, {
    localStorage: { getItem: () => {
      if (saved === "blocked") throw new Error("Storage blocked");
      return saved;
    } },
    window: { matchMedia: dark === null ? undefined : () => {
      if (dark === "blocked") throw new Error("Media unavailable");
      return { matches: dark };
    } },
    document: { documentElement: root, querySelector: () => ({
      setAttribute: (name: string, value: string) => { meta[name] = value; },
    }) },
  });
  expect(root.dataset.appearance).toBe(expected);
  expect(meta.content).toBe(expected === "night" ? "#151e18" : "#f5f3ec");
});
it("loads the same-origin bootstrap in the head before the app module", () => {
  const html = readFileSync("index.html", "utf8");
  const script = html.indexOf('<script src="/appearance-init.js"></script>');
  expect(script).toBeGreaterThan(-1);
  expect(script).toBeLessThan(html.indexOf("</head>"));
  expect(script).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
});
