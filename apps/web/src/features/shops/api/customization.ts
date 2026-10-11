import type {
  AddOnResponse,
  AddOnsResponse,
  CreateAddOnRequest,
  UpdateAddOnRequest,
  CreateProductVariantRequest,
  UpdateProductVariantRequest,
  CreateProductOptionGroupRequest,
  UpdateProductOptionGroupRequest,
  ProductVariantsResponse,
  ProductVariantResponse,
  ProductOptionGroupResponse,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";

const shop = (id: string) => `/shops/${encodeURIComponent(id)}`;
const product = (shopId: string, id: string) =>
  `${shop(shopId)}/products/${encodeURIComponent(id)}`;
export const customizationKey = (
  userId: string,
  shopId: string,
  productId?: string,
) => ["customization", userId, shopId, productId ?? "library"] as const;
function verify<T extends { shopId: string }>(record: T, shopId: string): T {
  if (record.shopId !== shopId)
    throw new Error("The shop context could not be verified.");
  return record;
}
export async function listAddOns(shopId: string, signal?: AbortSignal) {
  const { data } = await api.get<AddOnsResponse>(`${shop(shopId)}/add-ons`, {
    signal,
  });
  data.addOns.forEach((item) => verify(item, shopId));
  return data;
}
export async function listProductAddOns(
  shopId: string,
  productId: string,
  signal?: AbortSignal,
) {
  const { data } = await api.get<AddOnsResponse>(
    `${product(shopId, productId)}/add-ons`,
    { signal },
  );
  data.addOns.forEach((item) => verify(item, shopId));
  return data;
}
export async function saveAddOn(
  shopId: string,
  input: CreateAddOnRequest | UpdateAddOnRequest,
  id?: string,
) {
  const url = `${shop(shopId)}/add-ons${id ? `/${encodeURIComponent(id)}` : ""}`;
  const { data } = id
    ? await api.patch<AddOnResponse>(url, input)
    : await api.post<AddOnResponse>(url, input);
  verify(data.addOn, shopId);
  return data;
}
export async function assignAddOn(
  shopId: string,
  productId: string,
  addOnId: string,
) {
  const { data } = await api.post<AddOnResponse>(
    `${product(shopId, productId)}/add-ons`,
    { addOnId },
  );
  verify(data.addOn, shopId);
  return data;
}
export async function unassignAddOn(
  shopId: string,
  productId: string,
  addOnId: string,
) {
  await api.delete(
    `${product(shopId, productId)}/add-ons/${encodeURIComponent(addOnId)}`,
  );
}
export async function listVariants(
  shopId: string,
  productId: string,
  signal?: AbortSignal,
) {
  const { data } = await api.get<ProductVariantsResponse>(
    `${product(shopId, productId)}/variants`,
    { signal },
  );
  for (const item of [...data.variants, ...data.optionGroups]) {
    verify(item, shopId);
    if (item.productId !== productId)
      throw new Error("The product context could not be verified.");
  }
  return data;
}
export async function saveVariant(
  shopId: string,
  productId: string,
  input: CreateProductVariantRequest | UpdateProductVariantRequest,
  id?: string,
) {
  const url = `${product(shopId, productId)}/variants${id ? `/${encodeURIComponent(id)}` : ""}`;
  const { data } = id
    ? await api.patch<ProductVariantResponse>(url, input)
    : await api.post<ProductVariantResponse>(url, input);
  verify(data.variant, shopId);
  if (data.variant.productId !== productId)
    throw new Error("The product context could not be verified.");
  return data;
}
export async function deleteVariant(
  shopId: string,
  productId: string,
  id: string,
) {
  await api.delete(
    `${product(shopId, productId)}/variants/${encodeURIComponent(id)}`,
  );
}
export async function saveOptionGroup(
  shopId: string,
  productId: string,
  input: CreateProductOptionGroupRequest | UpdateProductOptionGroupRequest,
  id?: string,
) {
  const url = `${product(shopId, productId)}/option-groups${id ? `/${encodeURIComponent(id)}` : ""}`;
  const { data } = id
    ? await api.patch<ProductOptionGroupResponse>(url, input)
    : await api.post<ProductOptionGroupResponse>(url, input);
  verify(data.optionGroup, shopId);
  if (data.optionGroup.productId !== productId)
    throw new Error("The product context could not be verified.");
  return data;
}
export async function deleteAddOn(shopId: string, id: string) {
  await api.delete(`${shop(shopId)}/add-ons/${encodeURIComponent(id)}`);
}
