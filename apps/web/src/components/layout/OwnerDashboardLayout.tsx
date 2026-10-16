import { ShopLogo } from "../shops/ShopLogo";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  FiCoffee,
  FiGrid,
  FiSettings,
  FiUser,
  FiLogOut,
  FiMenu,
  FiChevronDown,
  FiCheck,
  FiLayers,
  FiEye,
  FiPackage,
  FiShoppingBag,
  FiSliders,
  FiUsers,
} from "react-icons/fi";
import type { CurrentUserResponse, UserMembership } from "@paserve/contracts";
import { hasShopPermission } from "@paserve/contracts";
import { currentUserKey, logoutAccount } from "../../features/auth/api/session";
import {
  rememberShop,
  shopPath,
  useActiveShop,
} from "../../features/shops/active-shop";
import { AppearanceToggle } from "./AppearanceToggle";
import { InlineMessage } from "../feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";
import "./dashboard-sidebar.css";
import "./dashboard-header.css";
import { canUseCashier } from "../../features/cashier/access";

export function OwnerDashboardLayout() {
  const membership = useActiveShop();
  return (
    <DashboardFrame membership={membership}>
      <Outlet />
    </DashboardFrame>
  );
}

// Also renders while access is pending/denied. Tenant navigation requires a
// validated membership; account actions remain available in recovery states.
export function DashboardFrame({
  membership,
  children,
}: {
  membership: UserMembership | null;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const user = client.getQueryData<CurrentUserResponse>(currentUserKey)?.user;
  const navigate = useNavigate();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const shopMenu = useRef<HTMLDetailsElement>(null);
  const memberships =
    user?.memberships?.filter((item) => item.shop.isActive) ?? [];
  const choices =
    membership && !memberships.some((item) => item.shopId === membership.shopId)
      ? [membership, ...memberships]
      : memberships.map((item) =>
          membership && item.shopId === membership.shopId ? membership : item,
        );
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      for (const menu of [accountMenu.current, shopMenu.current]) {
        if (event.target instanceof Node && !menu?.contains(event.target))
          menu?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const logout = useMutation({
    mutationFn: logoutAccount,
    retry: false,
    onSuccess: () => {
      if (user?.id) rememberShop(user.id, null);
      feedback.clearTransient();
      feedback.toast("You are signed out.");
      client.clear();
      void navigate("/login", { replace: true });
    },
  });
  function closeNavigation() {
    setNavigationOpen(false);
    if (navigationOpen) navigationTrigger.current?.focus();
  }
  function dropdownKeys(event: KeyboardEvent<HTMLDetailsElement>) {
    const menu = event.currentTarget;
    if (event.key === "Escape") {
      menu.removeAttribute("open");
      menu.querySelector("summary")?.focus();
      event.preventDefault();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>(
        ".dashboard-dropdown-panel a, .dashboard-dropdown-panel button:not(:disabled)",
      ),
    );
    if (!items.length) return;
    event.preventDefault();
    menu.open = true;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (index + 1) % items.length
            : (index <= 0 ? items.length : index) - 1;
    items[next]?.focus();
  }
  return (
    <div className="dashboard-shell phase-two">
      <a className="skip-link" href="#dashboard-content">
        Skip to page content
      </a>
      <header className="workspace-header dashboard-header dashboard-header-compact">
        <Link className="wordmark" to="/app">
          <span className="brand-symbol">
            <FiCoffee aria-hidden="true" />
          </span>
          PaServe<span className="wordmark-period">.</span>
        </Link>
        <div className="dashboard-shop-control">
          {choices.length > 1 ? (
            <details
              ref={shopMenu}
              className="dashboard-shop-menu"
              onKeyDown={dropdownKeys}
            >
              <summary aria-label="Active shop">
                <ShopLogo
                  url={membership?.shop.logoUrl}
                  name={membership?.shop.name ?? "Shop"}
                />
                <span className="dashboard-switcher-label">
                  <span>Active shop</span>
                  <strong>{membership?.shop.name ?? "Choose a shop"}</strong>
                </span>
                <FiChevronDown aria-hidden="true" />
              </summary>
              <div className="dashboard-dropdown-panel dashboard-shop-panel">
                <p className="section-label">SWITCH WORKSPACE</p>
                {choices.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={
                      item.shopId === membership?.shopId ? "true" : undefined
                    }
                    onClick={() => {
                      shopMenu.current?.removeAttribute("open");
                      shopMenu.current?.querySelector("summary")?.focus();
                      closeNavigation();
                      if (item.shopId !== membership?.shopId)
                        void navigate(shopPath(item.shopId));
                    }}
                  >
                    <ShopLogo url={item.shop.logoUrl} name={item.shop.name} />
                    <span>
                      <strong>{item.shop.name}</strong>
                      <small>
                        /{item.shop.slug} · {item.role.toLowerCase()}
                      </small>
                    </span>
                    {item.shopId === membership?.shopId && (
                      <FiCheck aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </details>
          ) : (
            <div className="dashboard-shop-static">
              {membership && (
                <ShopLogo
                  url={membership.shop.logoUrl}
                  name={membership.shop.name}
                />
              )}
              <span className="dashboard-switcher-label">
                <span>{membership ? "Active shop" : "Shop workspace"}</span>
                <strong>{membership?.shop.name ?? "Choose a shop"}</strong>
              </span>
            </div>
          )}
        </div>
        <div className="header-actions">
          <AppearanceToggle />
          <details
            ref={accountMenu}
            className="dashboard-account-menu"
            onKeyDown={dropdownKeys}
          >
            <summary aria-label="Account menu">
              <FiUser aria-hidden="true" />
              <span>Account</span>
              <FiChevronDown aria-hidden="true" />
            </summary>
            <div className="dashboard-account-panel dashboard-dropdown-panel">
              <span className="section-label">SIGNED IN AS</span>
              <p>{user?.email ?? "Your account"}</p>
              <Link className="secondary-button" to="/app/account">
                <FiUser aria-hidden="true" />
                Your account
              </Link>
              <button
                className="secondary-button"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <FiLogOut aria-hidden="true" />
                {logout.isPending ? "Signing out…" : "Sign out"}
              </button>
              {logout.isError && (
                <InlineMessage>
                  We couldn’t sign you out. Please try again.
                </InlineMessage>
              )}
            </div>
          </details>
        </div>
      </header>
      <div className="dashboard-body">
        <button
          className="secondary-button dashboard-navigation-toggle"
          ref={navigationTrigger}
          aria-expanded={navigationOpen}
          aria-controls="dashboard-navigation"
          onClick={() => setNavigationOpen(!navigationOpen)}
        >
          <FiMenu aria-hidden="true" />
          Navigation
        </button>
        <aside
          className="dashboard-sidebar dashboard-sidebar-premium"
          id="dashboard-navigation"
          data-open={navigationOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeNavigation();
          }}
        >
          <p className="section-label dashboard-sidebar-label">YOUR SHOP</p>
          {membership && (
            <div className="dashboard-sidebar-identity">
              <ShopLogo
                url={membership.shop.logoUrl}
                name={membership.shop.name}
                className="dashboard-sidebar-emblem"
              />
              <div>
                <strong>{membership.shop.name}</strong>
                <p className="dashboard-shop-role">
                  {membership.role.toLowerCase()} workspace
                </p>
              </div>
            </div>
          )}
          <nav aria-label="Shop navigation">
            {membership && (
              <div
                className="dashboard-nav-group"
                role="group"
                aria-label="Workspace"
              >
                <p className="dashboard-nav-label">Workspace</p>
                <div className="dashboard-nav-links">
                  <NavLink
                    end
                    to={shopPath(membership.shopId)}
                    onClick={closeNavigation}
                  >
                    <FiGrid aria-hidden="true" />
                    <span>Overview</span>
                  </NavLink>
                  {canUseCashier(membership.role) && (
                    <NavLink to={`${shopPath(membership.shopId)}/cashier`} onClick={closeNavigation}>
                      <FiShoppingBag aria-hidden="true" />
                      <span>Cashier</span>
                    </NavLink>
                  )}
                  {hasShopPermission(membership.role, "shop.preparation.queue.read") && (
                    <NavLink to={`${shopPath(membership.shopId)}/kitchen`} onClick={closeNavigation}>
                      <FiCoffee aria-hidden="true" />
                      <span>Kitchen / Barista</span>
                    </NavLink>
                  )}
                  {membership.role === "OWNER" && (
                    <>
                      <NavLink to={`${shopPath(membership.shopId)}/orders`} onClick={closeNavigation}>
                        <FiShoppingBag aria-hidden="true" /><span>Orders</span>
                      </NavLink>
                      <NavLink to={`${shopPath(membership.shopId)}/staff`} onClick={closeNavigation}>
                        <FiUsers aria-hidden="true" /><span>Staff & invitations</span>
                      </NavLink>
                      <NavLink
                        to={`${shopPath(membership.shopId)}/menu-preview`}
                        onClick={closeNavigation}
                      >
                        <FiEye aria-hidden="true" />
                        <span>Menu preview</span>
                      </NavLink>
                      <NavLink
                        to={`${shopPath(membership.shopId)}/settings`}
                        onClick={closeNavigation}
                      >
                        <FiSettings aria-hidden="true" />
                        <span>Shop settings</span>
                      </NavLink>
                    </>
                  )}
                </div>
              </div>
            )}
            {membership &&
              hasShopPermission(membership.role, "shop.menu.manage") && (
                <div
                  className="dashboard-nav-group"
                  role="group"
                  aria-label="Menu management"
                >
                  <p className="dashboard-nav-label">Menu</p>
                  <div className="dashboard-nav-links">
                    <NavLink
                      to={`${shopPath(membership.shopId)}/products`}
                      onClick={closeNavigation}
                    >
                      <FiPackage aria-hidden="true" />
                      <span>Products</span>
                    </NavLink>
                    <NavLink
                      to={`${shopPath(membership.shopId)}/categories`}
                      onClick={closeNavigation}
                    >
                      <FiLayers aria-hidden="true" />
                      <span>Categories</span>
                    </NavLink>
                    <NavLink
                      to={`${shopPath(membership.shopId)}/add-ons`}
                      onClick={closeNavigation}
                    >
                      <FiSliders aria-hidden="true" />
                      <span>Add-ons</span>
                    </NavLink>
                  </div>
                </div>
              )}
            {membership &&
              hasShopPermission(membership.role, "shop.operations.manage") && (
                <div
                  className="dashboard-nav-group"
                  role="group"
                  aria-label="Restaurant management"
                >
                  <p className="dashboard-nav-label">Restaurant</p>
                  <div className="dashboard-nav-links">
                    <NavLink
                      to={`${shopPath(membership.shopId)}/tables`}
                      onClick={closeNavigation}
                    >
                      <FiGrid aria-hidden="true" />
                      <span>Tables</span>
                    </NavLink>
                  </div>
                </div>
              )}
            <div
              className="dashboard-nav-group dashboard-nav-account"
              role="group"
              aria-label="Account"
            >
              <p className="dashboard-nav-label">Account</p>
              <div className="dashboard-nav-links">
                <NavLink end to="/app/shops" onClick={closeNavigation}>
                  <FiShoppingBag aria-hidden="true" />
                  <span>Your shops</span>
                </NavLink>
                <NavLink to="/app/account" onClick={closeNavigation}>
                  <FiUser aria-hidden="true" />
                  <span>Your account</span>
                </NavLink>
              </div>
            </div>
          </nav>
        </aside>
        <main
          className="dashboard-content"
          id="dashboard-content"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
