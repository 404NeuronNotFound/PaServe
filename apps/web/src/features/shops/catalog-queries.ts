import { queryOptions } from "@tanstack/react-query";
import { categoriesKey, listCategories } from "./api/categories";
import { productsKey, listProducts } from "./api/products";
import {
  customizationKey,
  listVariants,
  listAddOns,
  listProductAddOns,
} from "./api/customization";
import { readTogether } from "../../lib/api/read-scheduling";

// Display/editor inputs only. Membership, quotes and transactions stay live.
const reuse = { staleTime: 15_000, gcTime: 120_000, retry: false } as const;

export const categoriesQuery = (userId: string, shopId: string) =>
  queryOptions({
    queryKey: categoriesKey(userId, shopId),
    queryFn: ({ signal }) => listCategories(shopId, signal),
    ...reuse,
  });
export const productsQuery = (userId: string, shopId: string) =>
  queryOptions({
    queryKey: productsKey(userId, shopId),
    queryFn: ({ signal }) => listProducts(shopId, signal),
    ...reuse,
  });
export const customizationQuery = (
  userId: string,
  shopId: string,
  productId: string,
) =>
  queryOptions({
    queryKey: customizationKey(userId, shopId, productId),
    queryFn: async ({ signal }) => {
      const [options, catalog, assigned] = await readTogether(
        [
          (groupSignal) => listVariants(shopId, productId, groupSignal),
          (groupSignal) => listAddOns(shopId, groupSignal),
          (groupSignal) => listProductAddOns(shopId, productId, groupSignal),
        ],
        signal,
      );
      return { ...options, catalog: catalog.addOns, assigned: assigned.addOns };
    },
    ...reuse,
  });
