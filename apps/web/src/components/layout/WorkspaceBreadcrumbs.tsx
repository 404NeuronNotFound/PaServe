import { Link, matchPath, useLocation } from "react-router-dom";
import type { UserMembership } from "@paserve/contracts";
import { shopPath } from "../../features/shops/active-shop";
import { navigationForRole } from "./workspace-navigation";
import "./workspace-navigation.css";

export function WorkspaceBreadcrumbs({ membership }: { membership: UserMembership | null }) {
  const { pathname } = useLocation();
  if (!membership) return null;
  const base = shopPath(membership.shopId);
  const item = navigationForRole(membership.role).flatMap((group) => group.items)
    .find((destination) => destination.path
      ? pathname === `${base}/${destination.path}` || pathname.startsWith(`${base}/${destination.path}/`)
      : pathname === base || pathname === `${base}/`);
  // Do not name unknown or unauthorized destinations in a recovery shell.
  if (!item) return null;
  let detail: string | undefined;
  if (item.path === "orders") {
    if (pathname === `${base}/orders/completed`) detail = "Completed orders";
    else if (pathname === `${base}/orders/cancelled`) detail = "Cancelled / rejected";
    else if (matchPath(`${base}/orders/:orderId`, pathname)) detail = "Order details";
  } else if (item.path === "products" && matchPath(`${base}/products/:productId/customize`, pathname)) {
    detail = "Product customization";
  }
  return (
    <nav className="workspace-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li><Link to="/app/shops">Your shops</Link></li>
        {item.path && <li><Link to={base}>Overview</Link></li>}
        <li>{detail ? <Link to={`${base}/${item.path}`}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>
        {detail && <li><span aria-current="page">{detail}</span></li>}
      </ol>
      <span className="workspace-location-shop">{membership.shop.name} · {membership.role.toLowerCase()}</span>
    </nav>
  );
}
