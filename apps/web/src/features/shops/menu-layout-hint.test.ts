import { afterEach, expect, it, vi } from "vitest";
import type { PublicMenuResponse } from "@paserve/contracts";
import { readMenuLayoutHint, rememberMenuLayoutHint } from "./menu-layout-hint";

const menu: PublicMenuResponse = {
  shop: {
    name: "Cafe",
    description: null,
    slug: "cafe",
    menuLayout: "grid",
    bannerUrl: "https://example.com/banner.webp",
  },
  products: [],
  categories: [],
  featuredProducts: [],
};
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it("remembers only anonymous shop-scoped geometry, never menu or table credentials", () => {
  rememberMenuLayoutHint(menu);
  expect(readMenuLayoutHint("cafe")).toEqual({
    layout: "grid",
    banner: true,
    count: 0,
    savedAt: expect.any(Number),
  });
  expect(readMenuLayoutHint("other-cafe")).toBeUndefined();
  const saved = JSON.parse(
    sessionStorage.getItem("paserve.public-menu-layout.v1")!,
  )[0];
  expect(Object.keys(saved).sort()).toEqual([
    "banner",
    "count",
    "layout",
    "savedAt",
    "slug",
  ]);
});

it("expires old hints and replaces changed layouts and removed banners", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  rememberMenuLayoutHint(menu);
  vi.mocked(Date.now).mockReturnValue(1000 + 30 * 60 * 1000);
  expect(readMenuLayoutHint("cafe")).toBeUndefined();
  rememberMenuLayoutHint({
    ...menu,
    shop: { ...menu.shop, menuLayout: "compact", bannerUrl: null },
  });
  expect(readMenuLayoutHint("cafe")).toMatchObject({
    layout: "compact",
    banner: false,
  });
});

it.each(["invalid JSON", "{}", '[{"slug":"cafe","layout":"invented"}]'])(
  "ignores malformed storage: %s",
  (value) => {
    sessionStorage.setItem("paserve.public-menu-layout.v1", value);
    expect(readMenuLayoutHint("cafe")).toBeUndefined();
  },
);

it("bounds storage and tolerates blocked storage", () => {
  for (let i = 0; i < 25; i++)
    rememberMenuLayoutHint({
      ...menu,
      shop: { ...menu.shop, slug: `shop-${i}` },
    });
  expect(
    JSON.parse(sessionStorage.getItem("paserve.public-menu-layout.v1")!),
  ).toHaveLength(20);
  expect(readMenuLayoutHint("shop-0")).toBeUndefined();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => rememberMenuLayoutHint(menu)).not.toThrow();
  expect(readMenuLayoutHint("cafe")).toBeUndefined();
});
