import type {
  CategoriesResponse,
  CreateCategoryRequest,
  CreateCategoryResponse,
  UpdateCategoryRequest,
  UpdateCategoryResponse,
  SetCategoryVisibilityRequest,
  ReorderCategoriesRequest,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import { collectPages } from "../../../lib/api/collection-pages";
import "../../auth/api/session";
export const categoriesKey = (userId: string, shopId: string) =>
  ["categories", userId, shopId] as const;
export async function reorderCategories(
  shopId: string,
  input: ReorderCategoriesRequest,
): Promise<CategoriesResponse> {
  return (
    await api.patch<CategoriesResponse>(
      `/shops/${encodeURIComponent(shopId)}/categories/reorder`,
      input,
    )
  ).data;
}
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
  const categories=await collectPages(async cursor=>{
    const {data}=await api.get<CategoriesResponse>(`/shops/${encodeURIComponent(shopId)}/categories`,{signal,...(cursor?{params:{cursor}}:{})});
    return {items:data.categories,nextCursor:data.nextCursor};
  },signal);
  return {categories};
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
