import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../../lib/api/client";
import { getShopMembership, updateShop } from "./context";

afterEach(() => vi.restoreAllMocks());
const membership = {
  id: "m",
  shopId: "a",
  role: "OWNER",
  shop: { id: "a", name: "Cafe", slug: "cafe", isActive: true },
};
it("sends the requested context in the URL and forwards cancellation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: { membership } });
  const signal = new AbortController().signal;
  expect(await getShopMembership("a", signal)).toEqual(membership);
  expect(get).toHaveBeenCalledWith("/shops/a/membership", { signal, timeout: 15000 });
});
it.each([
  { ...membership, shopId: "other" },
  { ...membership, shop: { ...membership.shop, id: "other" } },
  { ...membership, shop: { ...membership.shop, isActive: false } },
])("rejects a mismatched or inactive API context", async (invalid) => {
  vi.spyOn(api, "get").mockResolvedValue({ data: { membership: invalid } });
  await expect(getShopMembership("a")).rejects.toThrow("could not be verified");
});
it("captures each write's shop instead of relying on mutable global selection", async () => {
  const patch = vi
    .spyOn(api, "patch")
    .mockResolvedValue({ data: { shop: {} } });
  await updateShop("a", { name: "Cafe A" });
  await updateShop("b", { name: "Cafe B" });
  expect(patch.mock.calls).toEqual([
    ["/shops/a", { name: "Cafe A" }],
    ["/shops/b", { name: "Cafe B" }],
  ]);
});
