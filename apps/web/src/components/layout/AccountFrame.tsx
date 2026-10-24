import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  FiCoffee,
  FiUser,
  FiGrid,
  FiLogOut,
  FiMenu,
  FiChevronLeft,
  FiChevronRight,
} from "react-icons/fi";
import {
  currentUserKey,
  getCurrentUser,
  logoutAccount,
} from "../../features/auth/api/session";
import { rememberShop } from "../../features/shops/active-shop";
import { feedback } from "../../app/stores/feedback";
import { AppearanceToggle } from "./AppearanceToggle";
import { SkipLink } from "./SkipLink";
import { MobileWorkspaceNavigation } from "./MobileWorkspaceNavigation";
import { Button } from "../ui/button";
import { InlineMessage } from "../feedback/InlineMessage";
import "./dashboard-sidebar.css";
import "./dashboard-header.css";
import "./dashboard-frame.css";
import "./workspace-navigation.css";

export function AccountFrame({
  children,
  onSignedOut,
}: {
  children: ReactNode;
  onSignedOut?: () => void;
}) {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: currentUserKey,
    queryFn: getCurrentUser,
    enabled: false,
  });
  const user = data?.user;
  const location = useLocation();
  const navigate = useNavigate();
  const profile = location.pathname.endsWith("/profile");
  const places = location.pathname.endsWith("/places");
  const currentDestination = profile ? "Your profile" : places ? "Your places" : "Overview";
  const accountName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Your account";
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
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 760px)");
    if (!query) return;
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const rail = collapsed && !mobile;
  const logout = useMutation({
    mutationFn: logoutAccount,
    onSuccess: () => {
      onSignedOut?.();
      if (user?.id) rememberShop(user.id, null);
      feedback.clearTransient();
      feedback.toast("You are signed out.");
      client.clear();
      void navigate("/login", { replace: true });
    },
  });
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("paserve.sidebar.collapsed", String(next));
    } catch {
      /* Layout still works. */
    }
  }
  function closeNavigation() {
    setOpen(false);
    if (open) trigger.current?.focus();
  }
  const accountNavigation = (
    <nav aria-label="Account navigation">
      <div className="dashboard-nav-group">
        <p className="dashboard-nav-label">Personal</p>
        <div className="dashboard-nav-links">
          <Link
            to="/app/account"
            aria-current={!profile && !places ? "page" : undefined}
            title={rail ? "Overview" : undefined}
            onClick={closeNavigation}
          >
            <FiGrid aria-hidden="true" />
            <span>Overview</span>
          </Link>
          <Link
            to="/app/account/profile"
            aria-current={profile ? "page" : undefined}
            title={rail ? "Your profile" : undefined}
            onClick={closeNavigation}
          >
            <FiUser aria-hidden="true" />
            <span>Your profile</span>
          </Link>
          <Link
            to="/app/account/places"
            aria-current={places ? "page" : undefined}
            title={rail ? "Your places" : undefined}
            onClick={closeNavigation}
          >
            <FiCoffee aria-hidden="true" />
            <span>Your places</span>
          </Link>
        </div>
      </div>
    </nav>
  );
  return (
    <div
      className="dashboard-shell phase-two account-shell"
      data-sidebar-collapsed={rail}
    >
      <SkipLink targetId="account-content">Skip to page content</SkipLink>
      <header className="workspace-header dashboard-header dashboard-header-compact">
        <Link className="wordmark" to="/app/account">
          <span className="brand-symbol">
            <FiCoffee aria-hidden="true" />
          </span>
          PaServe<span className="wordmark-period">.</span>
        </Link>
        <span className="workspace-label">YOUR EVERYDAY SPACE</span>
        <div className="header-actions">
          <AppearanceToggle />
          <Button
            variant="outline"
            size="sm"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <FiLogOut aria-hidden="true" />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </header>
      <div className="dashboard-body">
        <Button variant="outline" size="inherit"
          ref={trigger}
          type="button"
          className="dashboard-navigation-toggle"
          aria-label="Navigation"
          aria-haspopup={mobile ? "dialog" : undefined}
          aria-expanded={open}
          aria-controls={mobile ? "mobile-workspace-navigation" : "account-navigation"}
          onClick={() => setOpen(!open)}
        >
          <span className="dashboard-mobile-location">
            <small>YOUR SPACE</small>
            <strong>{currentDestination}</strong>
          </span>
          <span className="dashboard-mobile-menu-label">
            <FiMenu aria-hidden="true" /> Menu
          </span>
        </Button>
        {!mobile && <aside
          id="account-navigation"
          className="dashboard-sidebar dashboard-sidebar-premium"
          data-open={open}
          aria-label="Workspace navigation"
          onKeyDown={(event) => {
            if (event.key === "Escape" && mobile) {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <div className="dashboard-sidebar-toolbar">
            <span className="dashboard-sidebar-label">YOUR SPACE</span>
            <button
              type="button"
              className="dashboard-sidebar-collapse"
              aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
              title={rail ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!rail}
              aria-controls="account-navigation"
              onClick={toggleSidebar}
            >
              {rail ? (
                <FiChevronRight aria-hidden="true" />
              ) : (
                <FiChevronLeft aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="dashboard-sidebar-identity">
            <span className="dashboard-sidebar-emblem">
              <FiUser aria-hidden="true" />
            </span>
            <div>
              <strong>{accountName}</strong>
              <p className="dashboard-shop-role">Personal account</p>
            </div>
          </div>
          {accountNavigation}
        </aside>}
        {mobile && <MobileWorkspaceNavigation open={open} onClose={closeNavigation}
          contextName={accountName} eyebrow="YOUR SPACE" title="Explore your space">
          {accountNavigation}
        </MobileWorkspaceNavigation>}
        <main className="dashboard-content" id="account-content" tabIndex={-1}>
          <nav className="workspace-breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link to="/app/account">Your account</Link>
              </li>
              <li>
                <span aria-current="page">
                  {currentDestination}
                </span>
              </li>
            </ol>
          </nav>
          {logout.isError && (
            <InlineMessage>
              We couldn’t sign you out. Please try again.
            </InlineMessage>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
