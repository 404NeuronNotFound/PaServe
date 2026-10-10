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
      <img src={url} alt={`${name} banner`} onError={() => setFailed(url)} />
    </div>
  );
}
