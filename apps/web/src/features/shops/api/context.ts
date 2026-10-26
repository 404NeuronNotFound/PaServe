import type {
  ShopMembershipResponse,
  UpdateShopRequest,
  UpdateShopResponse,
  ShopSettingsResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../../lib/api/client";
import "../../auth/api/session";

// Capture the target in each request; switching tabs/shops cannot retarget it.
export async function getShopMembership(shopId: string, signal?: AbortSignal) {
  const { data } = await api.get<ShopMembershipResponse>(
    `/shops/${encodeURIComponent(shopId)}/membership`,
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  if (
    data.membership.shopId !== shopId ||
    data.membership.shop.id !== shopId ||
    !data.membership.shop.isActive
  )
    throw new Error("The shop context could not be verified.");
  return data.membership;
}

export async function updateShop(
  shopId: string,
  input: UpdateShopRequest,
): Promise<UpdateShopResponse> {
  const { data } = await api.patch<UpdateShopResponse>(
    `/shops/${encodeURIComponent(shopId)}`,
    input,
  );
  return data;
}

export async function getShopSettings(
  shopId: string,
  signal?: AbortSignal,
): Promise<ShopSettingsResponse> {
  const { data } = await api.get<ShopSettingsResponse>(
    `/shops/${encodeURIComponent(shopId)}/settings`,
    { signal },
  );
  if (data.shop.id !== shopId || !data.shop.isActive)
    throw new Error("The shop settings could not be verified.");
  return data;
}
