import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../../lib/api/client";
import {
  assignAddOn,
  deleteVariant,
  deleteAddOn,
  listAddOns,
  listVariants,
  saveAddOn,
} from "./customization";

afterEach(() => vi.restoreAllMocks());
it("deletes a shared add-on through its encoded shop route", async () => {
  const remove = vi.spyOn(api, "delete").mockResolvedValue({});
  await deleteAddOn("a/b", "oat/x");
  expect(remove).toHaveBeenCalledWith("/shops/a%2Fb/add-ons/oat%2Fx");
});
it("encodes the full product and shop scope when deleting an option", async () => {
  const remove = vi.spyOn(api, "delete").mockResolvedValue({});
  await deleteVariant("a/b", "p/x", "v/y");
  expect(remove).toHaveBeenCalledWith(
    "/shops/a%2Fb/products/p%2Fx/variants/v%2Fy",
  );
});
it("captures and encodes tenant/product targets and sends only assignment IDs", async () => {
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ data: { addOn: { shopId: "a/b" } } });
  await assignAddOn("a/b", "p/x", "oat");
  expect(post).toHaveBeenCalledWith("/shops/a%2Fb/products/p%2Fx/add-ons", {
    addOnId: "oat",
  });
});
it("forwards cancellation and rejects foreign catalog records", async () => {
  const signal = new AbortController().signal;
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValue({ data: { addOns: [{ shopId: "other" }] } });
  await expect(listAddOns("a", signal)).rejects.toThrow(
    "could not be verified",
  );
  expect(get).toHaveBeenCalledWith("/shops/a/add-ons", { signal });
});
it("rejects variants returned for a different product in the same shop", async () => {
  vi.spyOn(api, "get").mockResolvedValue({
    data: { optionGroups: [], variants: [{ shopId: "a", productId: "other" }] },
  });
  await expect(listVariants("a", "p")).rejects.toThrow("product context");
});
it("rejects a mutation response from a different shop", async () => {
  vi.spyOn(api, "patch").mockResolvedValue({
    data: { addOn: { shopId: "b" } },
  });
  await expect(saveAddOn("a", { priceAdjustment: "0" }, "id")).rejects.toThrow(
    "could not be verified",
  );
});
