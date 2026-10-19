import { SHOP_BANNER_LIMITS } from "@paserve/contracts";
import { useState } from "react";
import "./shop-banner.css";

export function ShopBanner({
  url,
  name,
  preserveSpace = false,
}: {
  url?: string | null;
  name: string;
  preserveSpace?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url) return null;
  if (failed === url)
    return preserveSpace ? <div className="shop-banner" aria-hidden="true" /> : null;
  return (
    <div className="shop-banner">
      <img
        src={url}
        alt={`${name} banner`}
        width={SHOP_BANNER_LIMITS.outputWidth}
        height={SHOP_BANNER_LIMITS.outputHeight}
        decoding="async"
        loading="lazy"
        fetchPriority="low"
        onError={() => setFailed(url)}
      />
    </div>
  );
}
