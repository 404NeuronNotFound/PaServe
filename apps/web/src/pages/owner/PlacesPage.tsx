import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FiArrowUpRight, FiCoffee, FiPlus, FiSearch } from "react-icons/fi";
import { AccountFrame } from "../../components/layout/AccountFrame";
import { Button } from "../../components/ui/button";
import { SearchField } from "../../components/forms/SearchField";
import { ShopLogo } from "../../components/shops/ShopLogo";
import { AccessSkeleton } from "../../components/feedback/LoadingSkeleton";
import {
  currentUserKey,
  getCurrentUser,
} from "../../features/auth/api/session";
import { rememberedShop, shopPath } from "../../features/shops/active-shop";
import "./places.css";

export function PlacesPage() {
  const { data } = useQuery({
    queryKey: currentUserKey,
    queryFn: getCurrentUser,
    enabled: false,
  });
  const [search, setSearch] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }
  useEffect(() => {
    document.title = "Your places · PaServe";
    headingRef.current?.focus();
  }, []);
  const memberships = data?.user.memberships ?? [];
  const query = search.trim().toLocaleLowerCase();
  const visible = memberships.filter(({ shop, role }) =>
    [shop.name, shop.slug, role].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
  const lastVisited = data ? rememberedShop(data.user.id) : null;
  return (
    <AccountFrame>
      <div className="places-page">
        <header className="page-header">
          <div>
            <p className="section-label">YOUR PEOPLE & PLACES</p>
            <h1 ref={headingRef} tabIndex={-1}>
              Your places
            </h1>
            <p>
              Pick up where you left off. Your shops and team memberships,
              together.
            </p>
          </div>
          <Button asChild className="places-create-shop">
            <Link to="/app/onboarding/create-shop">
              <FiPlus aria-hidden="true" />
              Create shop
            </Link>
          </Button>
        </header>
        {!data ? (
          <AccessSkeleton label="Loading your places…" />
        ) : memberships.length ? (
          <>
            <div className="places-toolbar">
              <SearchField className="places-search"
                  label="Search your places" clearLabel="Clear place search"
                  id="places-search"
                  ref={searchInput}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onClear={clearSearch}
                  placeholder="Search your places…"
                  autoComplete="off"
                  aria-describedby="places-search-hint"
                />
              <p id="places-search-hint" className="sr-only">Find a shop by name, role or menu address.</p>
              <p role="status">
                {query
                  ? `${visible.length} of ${memberships.length}`
                  : memberships.length}{" "}
                {memberships.length === 1 ? "membership" : "memberships"}
              </p>
            </div>
            {visible.length ? (
              <ul className="places-grid">
                {visible.map(({ id, shopId, role, shop }) => (
                  <li key={id} className="place-card">
                    <div className="place-card-top">
                      <ShopLogo
                        url={shop.logoUrl}
                        name={shop.name}
                        className="place-logo"
                      />
                      <span className="place-role">{role.toLowerCase()}</span>
                    </div>
                    <div className="place-card-body">
                      <h2>{shop.name}</h2>
                      <p className="place-address">/{shop.slug}</p>
                      <p className="place-status">
                        <span
                          className={shop.isActive ? "status-dot" : undefined}
                          aria-hidden="true"
                        />
                        {shop.isActive ? "Available shop" : "Inactive shop"}
                        {shop.isActive && shopId === lastVisited
                          ? " · Last visited"
                          : ""}
                      </p>
                    </div>
                    <div className="place-card-footer">
                      {shop.isActive ? (
                        <Button asChild variant="outline">
                          <Link
                            to={shopPath(shopId)}
                            aria-label={`Open ${shop.name}`}
                          >
                            Open workspace
                            <FiArrowUpRight aria-hidden="true" />
                          </Link>
                        </Button>
                      ) : (
                        <p>This workspace is currently unavailable.</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="places-empty">
                <FiSearch aria-hidden="true" />
                <h2>No places found</h2>
                <p>Try another shop name, role or menu address.</p>
                <Button
                  variant="outline"
                  onClick={clearSearch}
                >
                  Clear search
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="places-empty">
            <FiCoffee aria-hidden="true" />
            <h2>A place for your next chapter.</h2>
            <p>
              Create your first shop, or ask your shop owner for an invitation
              to join their team.
            </p>
            <Button asChild variant="outline">
              <Link to="/app/onboarding/create-shop">
                Set up your first shop
                <FiArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        )}
      </div>
    </AccountFrame>
  );
}
