import { MediaImage } from "../media/MediaImage";
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
  return (
    <span className={`shop-logo ${className}`}>
      <MediaImage src={url} alt={`${name} logo`} fit="contain"
        width={SHOP_LOGO_LIMITS.outputDimension} height={SHOP_LOGO_LIMITS.outputDimension}
        fallback={<FiCoffee aria-hidden="true" />} />
    </span>
  );
}
