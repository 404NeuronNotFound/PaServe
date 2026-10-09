import { useEffect, useRef, useState, type ReactNode } from "react";
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
} from "react-icons/fi";
import type { CurrentUserResponse, UserMembership } from "@paserve/contracts";
import { currentUserKey, logoutAccount } from "../../features/auth/api/session";
import {
  rememberShop,
  shopPath,
  useActiveShop,
} from "../../features/shops/active-shop";
import { AppearanceToggle } from "./AppearanceToggle";
import { InlineMessage } from "../feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";

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
      if (
        event.target instanceof Node &&
        !accountMenu.current?.contains(event.target)
      )
        accountMenu.current?.removeAttribute("open");
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
  return (
    <div className="dashboard-shell phase-two">
      <a className="skip-link" href="#dashboard-content">
        Skip to page content
      </a>
      <header className="workspace-header dashboard-header">
        <Link className="wordmark" to="/app">
          <span className="brand-symbol">
            <FiCoffee aria-hidden="true" />
          </span>
          PaServe<span className="wordmark-period">.</span>
        </Link>
        <div className="dashboard-shop-control">
          {choices.length > 1 ? (
            <>
              <label htmlFor="dashboard-shop">Active shop</label>
              <select
                id="dashboard-shop"
                value={membership?.shopId ?? ""}
                onChange={(event) => {
                  if (event.target.value) {
                    closeNavigation();
                    void navigate(shopPath(event.target.value));
                  }
                }}
              >
                {!membership && <option value="">Choose a shop</option>}
                {choices.map((item) => (
                  <option key={item.id} value={item.shopId}>
                    {item.shop.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <span className="section-label">
                {membership ? "ACTIVE SHOP" : "SHOP WORKSPACE"}
              </span>
              <strong>{membership?.shop.name ?? "Choose a shop"}</strong>
            </>
          )}
        </div>
        <div className="header-actions">
          <AppearanceToggle />
          <details
            ref={accountMenu}
            className="dashboard-account-menu"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                accountMenu.current?.removeAttribute("open");
                accountMenu.current?.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="Account menu">
              <FiUser aria-hidden="true" />
              <span>Account</span>
              <FiChevronDown aria-hidden="true" />
            </summary>
            <div className="dashboard-account-panel">
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
          className="dashboard-sidebar"
          id="dashboard-navigation"
          data-open={navigationOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeNavigation();
          }}
        >
          <p className="section-label">YOUR WORKSPACE</p>
          {membership && (
            <p className="dashboard-shop-role">
              {membership.role.toLowerCase()} · {membership.shop.name}
            </p>
          )}
          <nav aria-label="Shop navigation">
            {membership && (
              <NavLink
                end
                to={shopPath(membership.shopId)}
                onClick={closeNavigation}
              >
                <FiGrid aria-hidden="true" />
                Overview
              </NavLink>
            )}
            {membership?.role === "OWNER" && (
              <NavLink
                to={`${shopPath(membership.shopId)}/settings`}
                onClick={closeNavigation}
              >
                <FiSettings aria-hidden="true" />
                Shop settings
              </NavLink>
            )}
            <NavLink to="/app/shops" onClick={closeNavigation}>
              <FiCoffee aria-hidden="true" />
              Your shops
            </NavLink>
            <NavLink to="/app/account" onClick={closeNavigation}>
              <FiUser aria-hidden="true" />
              Your account
            </NavLink>
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
