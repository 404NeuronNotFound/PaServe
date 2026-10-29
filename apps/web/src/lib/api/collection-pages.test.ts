import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectPages, loadMenuPages } from "./collection-pages";
import { api } from "./client";
vi.mock("./client", () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
describe("Bounded collection transport", () => {
  it("follows continuation and preserves a complete collection", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "a" }], nextCursor: "next" })
      .mockResolvedValueOnce({ items: [{ id: "b" }], nextCursor: null });
    expect(await collectPages(read)).toEqual([{ id: "a" }, { id: "b" }]);
    expect(read).toHaveBeenNthCalledWith(2, "next");
  });
  it("rejects repeats and oversized pages rather than returning partial data", async () => {
    await expect(
      collectPages(async () => ({ items: [{ id: "a" }], nextCursor: "same" })),
    ).rejects.toThrow();
    await expect(
      collectPages(async () => ({
        items: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })),
      })),
    ).rejects.toThrow();
  });
  it("bounds page count even if the server emits endlessly unique cursors", async () => {
    let n = 0;
    await expect(
      collectPages(async () => ({ items: [], nextCursor: String(++n) })),
    ).rejects.toThrow();
    expect(n).toBe(100);
  });
  it("stops before another page when cancelled", async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => {
      controller.abort();
      return { items: [{ id: "a" }], nextCursor: "next" };
    });
    await expect(collectPages(read, controller.signal)).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("continues menu products without repeating a completed category facet", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        data: {
          shop: { slug: "shop" },
          products: [{ id: "a", isFeatured: true, sortOrder: 1 }],
          categories: [{ id: "cat" }],
          nextProductsCursor: "next",
        },
      })
      .mockResolvedValueOnce({
        data: {
          shop: { slug: "shop" },
          products: [{ id: "b", isFeatured: true, sortOrder: 0 }],
          categories: [],
        },
      });
    const result = await loadMenuPages("/menu/shop");
    expect(result.products.map((p) => p.id)).toEqual(["a", "b"]);
    expect(result.featuredProducts.map((p) => p.id)).toEqual(["b", "a"]);
    expect(result.categories).toHaveLength(1);
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      "/menu/shop",
      expect.objectContaining({
        params: { productsCursor: "next", categoriesCursor: "end" },
      }),
    );
  });
});
