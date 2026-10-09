import type { CreateShopRequest, CreateShopResponse } from "@paserve/contracts";
import { api } from "../../../lib/api/client";
// Install the existing bearer-token and session refresh interceptors.
import "../../auth/api/session";

export async function createShop(
  input: CreateShopRequest,
): Promise<CreateShopResponse> {
  const { data } = await api.post<CreateShopResponse>("/shops", input);
  return data;
}
