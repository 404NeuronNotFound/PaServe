import { useState } from "react";
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
        <img src={url} alt={`${name} logo`} decoding="async" fetchPriority="low" onError={() => setFailed(url)} />
      ) : (
        <FiCoffee aria-hidden="true" />
      )}
    </span>
  );
}
