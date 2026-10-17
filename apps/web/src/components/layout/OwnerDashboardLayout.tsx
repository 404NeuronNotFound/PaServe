import { ShopLogo } from "../shops/ShopLogo";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "react-router-dom";
import {
  FiCoffee,
  FiUser,
  FiLogOut,
  FiMenu,
  FiChevronLeft,
  FiChevronRight,
  FiChevronDown,
  FiCheck,
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
import "./dashboard-sidebar.css";
import "./dashboard-header.css";
import "./dashboard-frame.css";
import { DashboardSidebarNavigation } from "./DashboardSidebarNavigation";

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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("paserve.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.("(max-width: 760px)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 760px)");
    if (!query) return;
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const rail = collapsed && !mobile;
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("paserve.sidebar.collapsed", String(next));
    } catch {
      // Navigation still works when preference storage is unavailable.
    }
  }
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
    <div className="dashboard-shell phase-two" data-sidebar-collapsed={rail}>
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
          <div className="dashboard-sidebar-toolbar">
            <span className="dashboard-sidebar-label">WORKSPACE</span>
            <button
              type="button"
              className="dashboard-sidebar-collapse"
              onClick={toggleSidebar}
              aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
              title={rail ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!rail}
              aria-controls="dashboard-navigation"
            >
              {rail ? <FiChevronRight aria-hidden="true" /> : <FiChevronLeft aria-hidden="true" />}
            </button>
          </div>
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
          <DashboardSidebarNavigation
            membership={membership}
            rail={rail}
            onNavigate={closeNavigation}
          />
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
