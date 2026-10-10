import type { ShopBannerResponse } from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";

export async function uploadShopBanner(
  shopId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ShopBannerResponse> {
  const body = new FormData();
  body.append("file", file);
  return (
    await api.post<ShopBannerResponse>(
      `/shops/${encodeURIComponent(shopId)}/banner`,
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
