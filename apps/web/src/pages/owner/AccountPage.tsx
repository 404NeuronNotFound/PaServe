import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
import { feedback } from "../../app/stores/feedback";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { rememberShop, shopPath } from "../../features/shops/active-shop";

export function AccountPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const createdShopName = (
    location.state as { createdShopName?: string } | null
  )?.createdShopName;
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
      if (user?.id) rememberShop(user.id, null);
      feedback.clearTransient();
      feedback.toast("You are signed out.");
      client.clear();
      void navigate("/login", { replace: true });
    },
  });
  return (
    <main className="account-page phase-two account-overview-page">
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
          <div className="account-hero">
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
            <div className="account-hero-action">
              <span className="hero-coffee-mark" aria-hidden="true">
                <FiCoffee />
              </span>
              <p>
                A little ambition.
                <br />
                <em>A place of your own.</em>
              </p>
              <Link className="primary-button" to="/app/onboarding/create-shop">
                Add a new shop <FiArrowUpRight aria-hidden="true" />
              </Link>
            </div>
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
            <InlineMessage>
              We couldn’t sign you out. Please try again.
            </InlineMessage>
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
              {createdShopName && (
                <InlineMessage tone="success" className="shop-created-status">
                  {createdShopName} is ready. You are its owner.
                </InlineMessage>
              )}
              {user?.memberships?.length ? (
                <ul className="membership-list">
                  {user.memberships.map((membership) => (
                    <li key={membership.id}>
                      <span className="shop-icon">
                        <FiCoffee aria-hidden="true" />
                      </span>
                      <div className="membership-details">
                        <strong>{membership.shop.name}</strong>
                        <span>
                          {membership.role.charAt(0) +
                            membership.role.slice(1).toLowerCase()}{" "}
                          ·{" "}
                          {membership.shop.isActive
                            ? "Available shop"
                            : "Inactive shop"}
                        </span>
                        <span className="membership-slug">
                          /{membership.shop.slug}
                        </span>
                      </div>
                      {membership.shop.isActive && (
                        <Link
                          className="secondary-button"
                          to={shopPath(membership.shopId)}
                          aria-label={`Manage ${membership.shop.name}`}
                        >
                          Manage shop <FiArrowUpRight aria-hidden="true" />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty-workspace">
                  <FiCoffee aria-hidden="true" />
                  <p>
                    Your account is ready. Create your first shop to get
                    started.
                  </p>
                  <span>Your shop memberships will appear here.</span>
                </div>
              )}
              <Link
                className="secondary-button shop-create-link"
                to="/app/onboarding/create-shop"
              >
                <FiCoffee aria-hidden="true" /> Create shop
              </Link>
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
