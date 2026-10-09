import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import type { CurrentUserResponse } from "@paserve/contracts";
import { FiCoffee } from "react-icons/fi";
import { currentUserKey } from "../../features/auth/api/session";
import { rememberedShop, shopPath } from "../../features/shops/active-shop";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";

export function ResolveActiveShop() {
  const user =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user;
  const shops = user.memberships.filter(
    (membership) => membership.shop.isActive,
  );
  const remembered = shops.find(
    (membership) => membership.shopId === rememberedShop(user.id),
  );
  const selected = remembered ?? (shops.length === 1 ? shops[0] : undefined);
  return (
    <Navigate
      replace
      to={
        selected
          ? shopPath(selected.shopId)
          : shops.length
            ? "/app/shops"
            : "/app/account"
      }
    />
  );
}

export function ShopSelectionPage() {
  const user =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user;
  const shops = user.memberships.filter(
    (membership) => membership.shop.isActive,
  );
  return (
    <main className="account-page shop-context-page">
      <header className="workspace-header">
        <Link className="wordmark" to="/app/account">
          <FiCoffee aria-hidden="true" /> PaServe.
        </Link>
        <AppearanceToggle />
      </header>
      <section className="shop-context-content membership-card">
        <p className="section-label">YOUR PEOPLE & PLACES</p>
        <h1>Choose a shop</h1>
        <p>Select the place you want to manage.</p>
        {shops.length ? (
          <ul className="shop-selection-list">
            {shops.map((membership) => (
              <li key={membership.id}>
                <Link
                  className="secondary-button"
                  to={shopPath(membership.shopId)}
                >
                  <FiCoffee aria-hidden="true" />{" "}
                  <span>
                    {membership.shop.name} · {membership.role.toLowerCase()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No available shops yet. Create a shop to get started.</p>
        )}
        <nav
          className="shop-context-actions"
          aria-label="Shop selection actions"
        >
          <Link className="primary-button" to="/app/onboarding/create-shop">
            Create shop
          </Link>
          <Link className="secondary-button" to="/app/account">
            Your account
          </Link>
        </nav>
      </section>
    </main>
  );
}
