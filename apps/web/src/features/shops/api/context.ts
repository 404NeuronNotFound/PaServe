import type {
  ShopMembershipResponse,
  UpdateShopRequest,
  UpdateShopResponse,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";

// Capture the target in each request; switching tabs/shops cannot retarget it.
export async function getShopMembership(shopId: string, signal?: AbortSignal) {
  const { data } = await api.get<ShopMembershipResponse>(
    `/shops/${encodeURIComponent(shopId)}/membership`,
    { signal },
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
