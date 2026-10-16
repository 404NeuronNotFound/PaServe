import { useId, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { IconType } from "react-icons";
import {
  FiChevronDown,
  FiClipboard,
  FiCoffee,
  FiCreditCard,
  FiEye,
  FiGrid,
  FiHome,
  FiLayers,
  FiLayout,
  FiPackage,
  FiSettings,
  FiSliders,
  FiUser,
  FiUsers,
  FiTrendingUp,
} from "react-icons/fi";
import { hasShopPermission, type UserMembership } from "@paserve/contracts";
import { shopPath } from "../../features/shops/active-shop";
import { canUseCashier } from "../../features/cashier/access";

function NavigationGroup({ label, name, active, rail, children }: {
  label: string;
  name: string;
  active: boolean;
  rail: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(active);
  return (
    <div className="dashboard-nav-group dashboard-nav-disclosure" role="group" aria-label={name}>
      <button
        type="button"
        className="dashboard-nav-group-toggle"
        aria-expanded={expanded || rail}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{label}</span>
        <FiChevronDown aria-hidden="true" />
      </button>
      <div id={id} className="dashboard-nav-links" hidden={!expanded && !rail}>
        {children}
      </div>
    </div>
  );
}

export function DashboardSidebarNavigation({ membership, rail, onNavigate }: {
  membership: UserMembership | null;
  rail: boolean;
  onNavigate: () => void;
}) {
  const { pathname } = useLocation();
  const base = membership ? shopPath(membership.shopId) : "";
  function destination(path: string, label: string, Icon: IconType, end = false) {
    return (
      <NavLink to={path} end={end} onClick={onNavigate} title={rail ? label : undefined}>
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </NavLink>
    );
  }
  const current = (paths: string[]) => paths.some(
    (path) => pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`),
  );
  const menuActive = current(["products", "categories", "add-ons", "menu-preview"]);
  const managementActive = current(["tables", "staff", "settings"]);
  return <nav aria-label="Shop navigation">
    {membership && <div className="dashboard-nav-group" role="group" aria-label="Workspace">
      <p className="dashboard-nav-label">Daily workspace</p>
      <div className="dashboard-nav-links">
        {destination(base, "Overview", FiGrid, true)}
        {hasShopPermission(membership.role, "shop.reports.read") && destination(`${base}/sales`, "Sales dashboard", FiTrendingUp)}
        {membership.role === "OWNER" && destination(`${base}/orders`, "Orders", FiClipboard)}
        {canUseCashier(membership.role) && destination(`${base}/cashier`, "Cashier", FiCreditCard)}
        {hasShopPermission(membership.role, "shop.preparation.queue.read") && destination(`${base}/kitchen`, "Kitchen / Barista", FiCoffee)}
      </div>
    </div>}
    {membership && hasShopPermission(membership.role, "shop.menu.manage") &&
      <NavigationGroup
        key={`${base}-menu-${menuActive}`}
        label="Menu & catalog" name="Menu management" rail={rail} active={menuActive}
      >
        {destination(`${base}/products`, "Products", FiPackage)}
        {destination(`${base}/categories`, "Categories", FiLayers)}
        {destination(`${base}/add-ons`, "Add-ons", FiSliders)}
        {membership.role === "OWNER" && destination(`${base}/menu-preview`, "Menu preview", FiEye)}
      </NavigationGroup>}
    {membership && hasShopPermission(membership.role, "shop.operations.manage") &&
      <NavigationGroup
        key={`${base}-management-${managementActive}`}
        label="Shop management" name="Restaurant management" rail={rail} active={managementActive}
      >
        {destination(`${base}/tables`, "Tables", FiLayout)}
        {membership.role === "OWNER" && <>
          {destination(`${base}/staff`, "Staff & invitations", FiUsers)}
          {destination(`${base}/settings`, "Shop settings", FiSettings)}
        </>}
      </NavigationGroup>}
    <div className="dashboard-nav-group dashboard-nav-account" role="group" aria-label="Account">
      <p className="dashboard-nav-label">Personal</p>
      <div className="dashboard-nav-links">
        {destination("/app/shops", "Your shops", FiHome, true)}
        {destination("/app/account", "Your account", FiUser)}
      </div>
    </div>
  </nav>;
}
