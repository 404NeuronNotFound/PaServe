import type { PublicMenuResponse } from "@paserve/contracts";
import { api } from "./client";

// Existing search/reorder workspaces need a complete collection. Transport is
// paged, and assembly has an explicit ceiling; never display a truncated list.
export const COLLECTION_CLIENT_MAX = 10_000;
export async function collectPages<T extends { id: string }>(
  read: (
    cursor?: string,
  ) => Promise<{ items: T[]; nextCursor?: string | null }>,
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [],
    ids = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    signal?.throwIfAborted();
    const result = await read(cursor);
    signal?.throwIfAborted();
    if (
      result.items.length > 100 ||
      items.length + result.items.length > COLLECTION_CLIENT_MAX
    )
      throw new Error(
        "This list exceeds the supported size. No partial list was loaded.",
      );
    for (const item of result.items) {
      if (ids.has(item.id))
        throw new Error(
          "The list changed while loading. Refresh to try again.",
        );
      ids.add(item.id);
      items.push(item);
    }
    if (!result.nextCursor) return items;
    if (cursors.has(result.nextCursor))
      throw new Error("The list could not advance. Refresh to try again.");
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error(
    "This list exceeds the supported size. No partial list was loaded.",
  );
}

export async function loadMenuPages(
  path: string,
  signal?: AbortSignal,
): Promise<PublicMenuResponse> {
  const products: PublicMenuResponse["products"] = [],
    categories: PublicMenuResponse["categories"] = [];
  const productIds = new Set<string>(),
    categoryIds = new Set<string>(),
    seen = new Set<string>();
  let productsCursor: string | undefined, categoriesCursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    signal?.throwIfAborted();
    const result = (
      await api.get<PublicMenuResponse>(path, {
        signal,
        timeout: 15_000,
        ...(page
          ? {
              params: {
                productsCursor: productsCursor ?? "end",
                categoriesCursor: categoriesCursor ?? "end",
              },
            }
          : {}),
      })
    ).data;
    signal?.throwIfAborted();
    if (result.products.length > 100 || result.categories.length > 100)
      throw new Error("This menu exceeds the supported page size.");
    for (const [rows, items, ids] of [
      [result.products, products, productIds],
      [result.categories, categories, categoryIds],
    ] as const) {
      for (const row of rows) {
        if (ids.has(row.id))
          throw new Error(
            "The menu changed while loading. Refresh to try again.",
          );
        ids.add(row.id);
      }
      // Each tuple's source and target have the same shape.
      if (rows === result.products) products.push(...result.products);
      else categories.push(...result.categories);
      if (items.length > COLLECTION_CLIENT_MAX)
        throw new Error(
          "This menu exceeds the supported size. No partial menu was loaded.",
        );
    }
    productsCursor = result.nextProductsCursor ?? undefined;
    categoriesCursor = result.nextCategoriesCursor ?? undefined;
    if (!productsCursor && !categoriesCursor)
      return {
        ...result,
        products,
        categories,
        featuredProducts:
          page === 0
            ? result.featuredProducts
            : products
                .filter((p) => p.isFeatured)
                .sort(
                  (a, b) =>
                    (a.featuredSortOrder ?? a.sortOrder) -
                      (b.featuredSortOrder ?? b.sortOrder) ||
                    a.id.localeCompare(b.id),
                ),
      };
    const pair = JSON.stringify([productsCursor, categoriesCursor]);
    if (seen.has(pair))
      throw new Error("The menu could not advance. Refresh to try again.");
    seen.add(pair);
  }
  throw new Error(
    "This menu exceeds the supported size. No partial menu was loaded.",
  );
}
