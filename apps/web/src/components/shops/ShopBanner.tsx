import { SHOP_BANNER_LIMITS } from "@paserve/contracts";
import { useState } from "react";
import "./shop-banner.css";

export function ShopBanner({
  url,
  name,
}: {
  url?: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return null;
  return (
    <div className="shop-banner">
      <img
        src={url}
        alt={`${name} banner`}
        width={SHOP_BANNER_LIMITS.outputWidth}
        height={SHOP_BANNER_LIMITS.outputHeight}
        decoding="async"
        onError={() => setFailed(url)}
      />
    </div>
  );
}
