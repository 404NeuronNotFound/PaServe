import type {
  ShopLogoResponse,
  ShopSettingsResponse,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";

export async function uploadShopLogo(
  shopId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ShopLogoResponse> {
  const body = new FormData();
  body.append("file", file);
  return (
    await api.post<ShopLogoResponse>(
      `/shops/${encodeURIComponent(shopId)}/logo`,
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

export async function deleteShopLogo(
  shopId: string,
): Promise<ShopSettingsResponse> {
  return (
    await api.delete<ShopSettingsResponse>(
      `/shops/${encodeURIComponent(shopId)}/logo`,
    )
  ).data;
}
