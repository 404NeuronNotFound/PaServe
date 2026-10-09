import type {
  CategoriesResponse,
  CreateCategoryRequest,
  CreateCategoryResponse,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";
export const categoriesKey = (userId: string, shopId: string) =>
  ["categories", userId, shopId] as const;
export async function listCategories(
  shopId: string,
  signal?: AbortSignal,
): Promise<CategoriesResponse> {
  return (
    await api.get<CategoriesResponse>(
      `/shops/${encodeURIComponent(shopId)}/categories`,
      { signal },
    )
  ).data;
}
export async function createCategory(
  shopId: string,
  input: CreateCategoryRequest,
): Promise<CreateCategoryResponse> {
  return (
    await api.post<CreateCategoryResponse>(
      `/shops/${encodeURIComponent(shopId)}/categories`,
      input,
    )
  ).data;
}
