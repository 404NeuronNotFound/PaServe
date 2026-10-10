import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useActiveShop, shopPath } from "../../features/shops/active-shop";
import { LiveMenuPreview } from "./LiveMenuPreview";

export function MenuPreviewPage() {
  const membership = useActiveShop();
  useEffect(() => {
    document.title = `Menu preview · ${membership.shop.name} · PaServe`;
  }, [membership.shop.name]);
  return (
    <section className="menu-preview-page" aria-labelledby="menu-preview-title">
      <header className="menu-preview-heading">
        <div>
          <p className="section-label">YOUR CUSTOMER MENU</p>
          <h1 id="menu-preview-title">Menu preview</h1>
          <p>
            Check your branding, featured items and menu order before sharing
            your menu.
          </p>
        </div>
        {membership.role === "OWNER" && (
          <Link
            className="secondary-button"
            to={`${shopPath(membership.shopId)}/settings`}
          >
            Edit branding
          </Link>
        )}
      </header>
      <LiveMenuPreview key={membership.shopId} />
    </section>
  );
}
