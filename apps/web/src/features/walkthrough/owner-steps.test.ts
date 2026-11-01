import { expect, it } from "vitest";
import {
  OWNER_WALKTHROUGH_PAGES,
  canAccessWalkthroughPage,
} from "@paserve/contracts";
import { ownerPageForPath, ownerPageSteps, shopPageSteps } from "./owner-steps";
import { shopSteps } from "./steps";

it.each(OWNER_WALKTHROUGH_PAGES)(
  "gives %s a contextual guide with a safe finish",
  (page) => {
    const steps = ownerPageSteps(page);
    expect(steps.length).toBeGreaterThan(3);
    expect(steps[0].pose).toBe("wave");
    expect(steps.at(-1)?.pose).toBe("done");
    expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
    expect(
      steps.slice(0, -1).every((step) => step.target && step.fallbackTarget),
    ).toBe(true);
  },
);
it("matches only known shop pages and groups order details without trusting arbitrary paths", () => {
  expect(ownerPageForPath("/app/shops/a/products")).toBe("products");
  expect(ownerPageForPath("/app/shops/a/products/p/customize")).toBe(
    "product-customize",
  );
  expect(ownerPageForPath("/app/shops/a/orders/completed")).toBe("orders");
  expect(ownerPageForPath("/app/shops/a/unknown")).toBeUndefined();
  expect(ownerPageForPath("/app/account/profile")).toBeUndefined();
});

it.each(["ADMIN", "MANAGER"] as const)(
  "provides %s with catalog guides using role-appropriate wording",
  (role) => {
    for (const page of [
      "products",
      "product-customize",
      "categories",
      "add-ons",
    ] as const) {
      const steps = shopPageSteps(page, role);
      expect(steps.length).toBeGreaterThan(3);
      expect(steps.at(-1)?.title).toContain(role.toLowerCase());
      expect(steps.map((step) => step.text).join(" ")).not.toContain("owner!");
      expect(steps.map((step) => step.text).join(" ")).not.toContain(
        "Menu preview",
      );
    }
  },
);
it("matches management-page guidance to actual role grants", () => {
  expect(canAccessWalkthroughPage("ADMIN", "tables")).toBe(true);
  expect(canAccessWalkthroughPage("MANAGER", "tables")).toBe(false);
  for (const role of ["ADMIN", "MANAGER"] as const)
    for (const page of ["staff", "settings", "menu-preview"] as const) {
      expect(shopPageSteps(page, role)).toEqual([]);
    }
  expect(shopSteps("ADMIN", "Cafe").map((step) => step.id)).toEqual(
    expect.arrayContaining(["categories", "add-ons", "tables"]),
  );
  expect(shopSteps("MANAGER", "Cafe").map((step) => step.id)).toEqual(
    expect.arrayContaining(["categories", "add-ons"]),
  );
  expect(
    shopSteps("MANAGER", "Cafe").some((step) => step.id === "tables"),
  ).toBe(false);
});
it("expands owner catalog guidance while preserving role-specific navigation", () => {
  expect(shopSteps("OWNER", "Cafe").map((step) => step.id)).toEqual(
    expect.arrayContaining([
      "categories",
      "add-ons",
      "menu-preview",
      "tables",
      "cashier",
      "kitchen",
    ]),
  );
  expect(
    shopSteps("CASHIER", "Cafe").some((step) => step.id === "products"),
  ).toBe(false);
});
