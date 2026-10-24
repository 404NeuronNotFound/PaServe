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
    const update = () => setMobile(query.matches);
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
        <button
          ref={trigger}
          type="button"
          className="dashboard-navigation-toggle"
          aria-expanded={open}
          aria-controls="account-navigation"
          onClick={() => setOpen(!open)}
        >
          <FiMenu aria-hidden="true" />
          Navigation
        </button>
        <aside
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
              <strong>
                {[user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
                  "Your account"}
              </strong>
              <p className="dashboard-shop-role">Personal account</p>
            </div>
          </div>
          <nav aria-label="Account navigation">
            <div className="dashboard-nav-group">
              <p className="dashboard-nav-label">Personal</p>
              <div className="dashboard-nav-links">
                <Link
                  to="/app/account"
                  aria-current={!profile && !places ? "page" : undefined}
                  title={rail ? "Overview" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <FiGrid aria-hidden="true" />
                  <span>Overview</span>
                </Link>
                <Link
                  to="/app/account/profile"
                  aria-current={profile ? "page" : undefined}
                  title={rail ? "Your profile" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <FiUser aria-hidden="true" />
                  <span>Your profile</span>
                </Link>
                <Link
                  to="/app/account/places"
                  aria-current={places ? "page" : undefined}
                  title={rail ? "Your places" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <FiCoffee aria-hidden="true" />
                  <span>Your places</span>
                </Link>
              </div>
            </div>
          </nav>
        </aside>
        <main className="dashboard-content" id="account-content" tabIndex={-1}>
          <nav className="workspace-breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link to="/app/account">Your account</Link>
              </li>
              <li>
                <span aria-current="page">
                  {profile
                    ? "Your profile"
                    : places
                      ? "Your places"
                      : "Overview"}
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
