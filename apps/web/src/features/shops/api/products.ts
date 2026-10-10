import type {
  CreateProductRequest,
  CreateProductResponse,
  ProductsResponse,
  UpdateProductRequest,
  UpdateProductResponse,
  ProductArchiveRequest,
  ProductArchiveResponse,
  ProductImageResponse,
  ProductAvailableRequest,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";
export const productsKey = (userId: string, shopId: string) =>
  ["products", userId, shopId] as const;
export async function setProductAvailable(
  shopId: string,
  productId: string,
  input: ProductAvailableRequest,
): Promise<CreateProductResponse> {
  return (
    await api.patch<CreateProductResponse>(
      `/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}/available`,
      input,
    )
  ).data;
}
export async function uploadProductImage(
  shopId: string,
  productId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductImageResponse> {
  const body = new FormData();
  body.append("file", file);
  return (
    await api.post<ProductImageResponse>(
      `/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}/image`,
      body,
      {
        onUploadProgress: (event) => {
          if (event.total)
            onProgress?.(Math.round((event.loaded * 100) / event.total));
        },
      },
    )
  ).data;
}
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
