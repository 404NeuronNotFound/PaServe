import { ShopLogo } from "../../components/shops/ShopLogo";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import type { CurrentUserResponse } from "@paserve/contracts";
import {
  FiArrowRight,
  FiCoffee,
  FiPlus,
  FiSearch,
  FiUser,
  FiX,
} from "react-icons/fi";
import { currentUserKey } from "../../features/auth/api/session";
import { rememberedShop, shopPath } from "../../features/shops/active-shop";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "./shop-selection.css";

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
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const visibleShops = shops.filter((membership) =>
    [membership.shop.name, membership.shop.slug, membership.role].some(
      (value) => value.toLocaleLowerCase().includes(query),
    ),
  );
  const lastVisited = rememberedShop(user.id);
  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }
  return (
    <div className="account-page shop-context-page phase-two shop-selection-page">
      <a className="skip-link" href="#shop-selection-content">
        Skip to your shops
      </a>
      <header className="workspace-header">
        <Link className="wordmark" to="/app/account">
          <span className="brand-symbol">
            <FiCoffee aria-hidden="true" />
          </span>
          PaServe<span className="wordmark-period">.</span>
        </Link>
        <span className="workspace-label selection-header-label">
          YOUR EVERYDAY SPACE
        </span>
        <div className="header-actions">
          <AppearanceToggle />
          <Link
            className="secondary-button selection-account-link"
            aria-label="Your account"
            to="/app/account"
          >
            <FiUser aria-hidden="true" /> <span>Your account</span>
          </Link>
        </div>
      </header>
      <main
        className="selection-content"
        id="shop-selection-content"
        tabIndex={-1}
      >
        <section className="selection-hero" aria-labelledby="selection-title">
          <div>
            <p className="section-label">
              <span className="selection-dot" aria-hidden="true" /> YOUR PEOPLE
              & PLACES
            </p>
            <h1 id="selection-title">
              Choose a <em>shop</em>
            </h1>
            <p className="selection-intro">
              Your next great service starts here. Choose the place you want to
              manage.
            </p>
          </div>
          <div className="selection-art" aria-hidden="true">
            <span className="selection-art-orbit" />
            <FiCoffee />
            <span className="selection-art-star">✳</span>
          </div>
        </section>
        <section
          className="selection-shops"
          aria-labelledby="selection-shops-title"
        >
          <div className="selection-toolbar">
            <div className="selection-section-heading">
              <h2 id="selection-shops-title">Your shops</h2>
              <span className="selection-count">{shops.length}</span>
            </div>
            <div className="selection-tools">
              {shops.length > 0 && (
                <div className="selection-search">
                  <FiSearch aria-hidden="true" />
                  <label className="sr-only" htmlFor="shop-search">
                    Search shops
                  </label>
                  <input
                    id="shop-search"
                    ref={searchInput}
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search your shops…"
                    aria-describedby="selection-search-hint"
                  />
                  {search && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={clearSearch}
                    >
                      <FiX aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              <Link className="primary-button" to="/app/onboarding/create-shop">
                <FiPlus aria-hidden="true" /> Create shop
              </Link>
            </div>
          </div>
          {shops.length > 0 && (
            <div className="selection-list-caption">
              <p id="selection-search-hint">
                Find a place by name, role or menu address.
              </p>
              <p role="status" aria-live="polite">
                {query
                  ? `${visibleShops.length} of ${shops.length} shops`
                  : `${shops.length} available ${shops.length === 1 ? "workspace" : "workspaces"}`}
              </p>
            </div>
          )}
          {visibleShops.length ? (
            <ul className="selection-grid">
              {visibleShops.map((membership) => (
                <li key={membership.id}>
                  <Link
                    className="selection-shop-card"
                    to={shopPath(membership.shopId)}
                  >
                    <div className="selection-card-cover" aria-hidden="true">
                      <span className="selection-card-orbit" />
                      <ShopLogo url={membership.shop.logoUrl} name={membership.shop.name} className="selection-card-emblem" />
                      <span className="selection-card-mark">✳</span>
                    </div>
                    <div className="selection-card-content">
                      <div className="selection-card-meta">
                        <span className="selection-role">
                          {membership.role.toLowerCase()}
                        </span>
                        {membership.shopId === lastVisited && (
                          <span className="selection-last-visited">
                            <span
                              className="selection-dot"
                              aria-hidden="true"
                            />
                            Last visited
                          </span>
                        )}
                      </div>
                      <h3>{membership.shop.name}</h3>
                      <p className="selection-menu-address">
                        /{membership.shop.slug}
                      </p>
                      <div className="selection-card-action">
                        <span>Open workspace</span>
                        <FiArrowRight aria-hidden="true" />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : shops.length ? (
            <div className="selection-empty">
              <FiSearch aria-hidden="true" />
              <h3>No shops found</h3>
              <InlineMessage tone="info" className="selection-empty-message">
                Try a different name, role or menu address.
              </InlineMessage>
              <button
                className="secondary-button"
                type="button"
                onClick={clearSearch}
              >
                Show all shops
              </button>
            </div>
          ) : (
            <div className="selection-empty">
              <FiCoffee aria-hidden="true" />
              <h3>A fresh start for your next place.</h3>
              <p>No available shops yet. Create a shop to get started.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
