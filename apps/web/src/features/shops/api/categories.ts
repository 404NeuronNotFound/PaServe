import type {
  CategoriesResponse,
  CreateCategoryRequest,
  CreateCategoryResponse,
  UpdateCategoryRequest,
  UpdateCategoryResponse,
  SetCategoryVisibilityRequest,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";
export const categoriesKey = (userId: string, shopId: string) =>
  ["categories", userId, shopId] as const;
export async function setCategoryVisibility(
  shopId: string,
  categoryId: string,
  input: SetCategoryVisibilityRequest,
): Promise<UpdateCategoryResponse> {
  return (
    await api.patch<UpdateCategoryResponse>(
      `/shops/${encodeURIComponent(shopId)}/categories/${encodeURIComponent(categoryId)}/visibility`,
      input,
    )
  ).data;
}
export async function deleteCategory(
  shopId: string,
  categoryId: string,
): Promise<void> {
  await api.delete(
    `/shops/${encodeURIComponent(shopId)}/categories/${encodeURIComponent(categoryId)}`,
  );
}
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
export async function updateCategory(
  shopId: string,
  categoryId: string,
  input: UpdateCategoryRequest,
): Promise<UpdateCategoryResponse> {
  return (
    await api.patch<UpdateCategoryResponse>(
      `/shops/${encodeURIComponent(shopId)}/categories/${encodeURIComponent(categoryId)}`,
      input,
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
