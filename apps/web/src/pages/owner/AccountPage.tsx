import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  FiArrowUpRight,
  FiCoffee,
  FiLogOut,
  FiMail,
  FiShield,
  FiUsers,
  FiGrid,
  FiUser,
} from "react-icons/fi";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey, logoutAccount } from "../../features/auth/api/session";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";

export function AccountPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const user = client.getQueryData<CurrentUserResponse>(currentUserKey)?.user;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = "Your account · PaServe";
    heading.current?.focus();
  }, []);
  const logout = useMutation({
    mutationFn: logoutAccount,
    retry: false,
    onSuccess: () => {
      client.clear();
      void navigate("/login", { replace: true });
    },
  });
  return (
    <main className="account-page">
      <header className="workspace-header">
        <Link className="wordmark" to="/app/account">
          <span className="brand-symbol">
            <FiCoffee aria-hidden="true" />
          </span>
          PaServe<span className="wordmark-period">.</span>
        </Link>
        <span className="workspace-label">
          <span className="status-dot" /> YOUR EVERYDAY SPACE
        </span>
        <div className="header-actions">
          <AppearanceToggle />
          <button
            className="secondary-button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <FiLogOut aria-hidden="true" />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>
      <div className="workspace-body">
        <aside className="workspace-sidebar" aria-label="Workspace navigation">
          <p className="section-label">YOUR SPACE</p>
          <nav>
            <a href="#overview">
              <FiGrid aria-hidden="true" />
              Overview
              <FiArrowUpRight aria-hidden="true" />
            </a>
            <a href="#profile-heading">
              <FiUser aria-hidden="true" />
              Your profile
            </a>
            <a href="#shops-heading">
              <FiCoffee aria-hidden="true" />
              Your places
            </a>
          </nav>
          <div className="sidebar-note">
            <span aria-hidden="true">✳</span>
            <p>
              Good service starts
              <br />
              with good people.
            </p>
          </div>
        </aside>
        <div className="account-content" id="overview">
          <div className="account-greeting">
            <p className="section-label">
              <span className="status-dot" />{" "}
              {user?.firstName
                ? `WELCOME BACK, ${user.firstName.toUpperCase()}`
                : "WELCOME TO YOUR NEXT CHAPTER"}
            </p>
            <h1 ref={heading} tabIndex={-1}>
              Your space.
              <br />
              <em>
                Your pace<span className="lime-period">.</span>
              </em>
            </h1>
            <p>You’re signed in. Make yourself at home.</p>
          </div>
          <div className="workspace-summary">
            <span>
              <FiUser aria-hidden="true" /> Your profile
            </span>
            <span>
              <FiCoffee aria-hidden="true" />
              {user?.memberships?.length ?? 0}{" "}
              {(user?.memberships?.length ?? 0) === 1
                ? "shop membership"
                : "shop memberships"}
            </span>
            <span>
              <FiShield aria-hidden="true" /> Session active
            </span>
          </div>
          {logout.isError && (
            <p className="form-error" role="alert">
              We couldn’t sign you out. Please try again.
            </p>
          )}
          <div className="account-grid">
            <section className="profile-card" aria-labelledby="profile-heading">
              <div className="card-heading">
                <p className="section-label">01 / YOUR PROFILE</p>
                <FiShield aria-hidden="true" />
              </div>
              <div className="profile-avatar" aria-hidden="true">
                {(
                  user?.firstName?.[0] ??
                  user?.email?.[0] ??
                  "P"
                ).toUpperCase()}
              </div>
              <h2 id="profile-heading">
                {[user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
                  "Your account"}
              </h2>
              <p className="profile-email">
                <FiMail aria-hidden="true" />
                {user?.email}
              </p>
              <div className="profile-status">
                <span className="status-dot" /> Signed in and ready
              </div>
            </section>
            <section
              className="membership-card"
              aria-labelledby="shops-heading"
            >
              <div className="card-heading">
                <p className="section-label">02 / YOUR PEOPLE & PLACES</p>
                <FiUsers aria-hidden="true" />
              </div>
              <h2 id="shops-heading">Your people. Your places.</h2>
              {user?.memberships?.length ? (
                <ul className="membership-list">
                  {user.memberships.map((membership) => (
                    <li key={membership.id}>
                      <span className="shop-icon">
                        <FiCoffee aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{membership.shop.name}</strong>
                        <span>
                          {membership.role.charAt(0) +
                            membership.role.slice(1).toLowerCase()}{" "}
                          ·{" "}
                          {membership.shop.isActive
                            ? "Active shop"
                            : "Inactive shop"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty-workspace">
                  <FiCoffee aria-hidden="true" />
                  <p>Your account is ready. Shop setup comes next.</p>
                  <span>Your shop memberships will appear here.</span>
                </div>
              )}
            </section>
          </div>
          <footer className="workspace-footer">
            <span>Small details. Better days.</span>
            <span>
              PASERVE <FiArrowUpRight aria-hidden="true" />
            </span>
          </footer>
        </div>
      </div>
    </main>
  );
}
