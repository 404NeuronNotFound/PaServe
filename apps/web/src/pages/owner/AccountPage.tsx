import { Button } from "../../components/ui/button";
import { ShopLogo } from "../../components/shops/ShopLogo";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, Navigate } from "react-router-dom";
import {
  FiArrowUpRight,
  FiCoffee,
  FiMail,
  FiShield,
  FiUser,
} from "react-icons/fi";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey } from "../../features/auth/api/session";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { shopPath } from "../../features/shops/active-shop";
import { AccountFrame } from "../../components/layout/AccountFrame";

export function AccountPage() {
  const client = useQueryClient();
  const location = useLocation();
  const createdShopName = (
    location.state as { createdShopName?: string } | null
  )?.createdShopName;
  const user = client.getQueryData<CurrentUserResponse>(currentUserKey)?.user;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = "Your account · PaServe";
    const target =
      location.hash === "#shops-heading"
        ? document.getElementById("shops-heading")
        : heading.current;
    target?.focus({ preventScroll: true });
    if (location.hash) target?.scrollIntoView?.({ block: "start" });
  }, [location.hash]);
  if (location.hash === "#profile-heading")
    return <Navigate to="/app/account/profile" replace />;
  return (
    <AccountFrame>
      <div className="account-overview" id="overview">
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

        <div className="account-grid">
          <section className="profile-card" aria-labelledby="profile-heading">
            <div className="card-heading">
              <p className="section-label">01 / YOUR PROFILE</p>
              <FiShield aria-hidden="true" />
            </div>
            <div className="profile-avatar" aria-hidden="true">
              {(user?.firstName?.[0] ?? user?.email?.[0] ?? "P").toUpperCase()}
            </div>
            <h2 id="profile-heading" tabIndex={-1}>
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
          <section className="membership-card" aria-labelledby="shops-heading">
            <div className="card-heading">
              <p className="section-label">02 / YOUR PEOPLE & PLACES</p>
              <Button asChild className="shop-create-link">
                <Link to="/app/onboarding/create-shop">
                  <FiCoffee aria-hidden="true" />
                  Create shop
                  <FiArrowUpRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <h2 id="shops-heading" tabIndex={-1}>
              Your people. Your places.
            </h2>
            {createdShopName && (
              <InlineMessage tone="success" className="shop-created-status">
                {createdShopName} is ready. You are its owner.
              </InlineMessage>
            )}
            {user?.memberships?.length ? (
              <ul className="membership-list">
                {user.memberships.map((membership) => (
                  <li key={membership.id}>
                    <ShopLogo
                      url={membership.shop.logoUrl}
                      name={membership.shop.name}
                      className="shop-icon"
                    />
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
                  Your account is ready. Create your first shop to get started.
                </p>
                <span>Your shop memberships will appear here.</span>
                <Link
                  className="primary-button"
                  to="/app/onboarding/create-shop"
                >
                  Set up your first shop
                </Link>
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
    </AccountFrame>
  );
}
