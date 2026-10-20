import { useState } from "react";
import { SHOP_LOGO_LIMITS } from "@paserve/contracts";
import { FiCoffee } from "react-icons/fi";
import "./shop-logo.css";

export function ShopLogo({
  url,
  name,
  className = "",
}: {
  url?: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={`shop-logo ${className}`}>
      {url && failed !== url ? (
        <img src={url} alt={`${name} logo`} width={SHOP_LOGO_LIMITS.outputDimension} height={SHOP_LOGO_LIMITS.outputDimension} loading="lazy" decoding="async" fetchPriority="low" onError={() => setFailed(url)} />
      ) : (
        <FiCoffee aria-hidden="true" />
      )}
    </span>
  );
}
