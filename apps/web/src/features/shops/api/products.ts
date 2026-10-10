import type {
  CreateProductRequest,
  CreateProductResponse,
  ProductsResponse,
  UpdateProductRequest,
  UpdateProductResponse,
  ProductArchiveRequest,
  ProductArchiveResponse,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";
export const productsKey = (userId: string, shopId: string) =>
  ["products", userId, shopId] as const;
export async function setProductArchived(
  shopId: string,
  productId: string,
  input: ProductArchiveRequest,
): Promise<ProductArchiveResponse> {
  return (
    await api.patch<ProductArchiveResponse>(
      `/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}/archive`,
      input,
    )
  ).data;
}
export async function updateProduct(
  shopId: string,
  productId: string,
  input: UpdateProductRequest,
): Promise<UpdateProductResponse> {
  return (
    await api.patch<UpdateProductResponse>(
      `/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}`,
      input,
    )
  ).data;
}
export async function listProducts(
  shopId: string,
  signal?: AbortSignal,
): Promise<ProductsResponse> {
  return (
    await api.get<ProductsResponse>(
      `/shops/${encodeURIComponent(shopId)}/products`,
      { signal },
    )
  ).data;
}
export async function createProduct(
  shopId: string,
  input: CreateProductRequest,
): Promise<CreateProductResponse> {
  return (
    await api.post<CreateProductResponse>(
      `/shops/${encodeURIComponent(shopId)}/products`,
      input,
    )
  ).data;
}
