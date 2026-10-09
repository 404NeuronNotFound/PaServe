import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { FiCoffee } from "react-icons/fi";
import { useActiveShop } from "../../features/shops/active-shop";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";

export function ActiveShopPage() {
  const membership = useActiveShop();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${membership.shop.name} · PaServe`;
    heading.current?.focus();
  }, [membership.shop.name]);
  return (
    <main className="account-page shop-context-page">
      <header className="workspace-header">
        <Link className="wordmark" to="/app/account">
          <FiCoffee aria-hidden="true" /> PaServe.
        </Link>
        <AppearanceToggle />
      </header>
      <section className="shop-context-content membership-card">
        <p className="section-label">CURRENTLY MANAGING</p>
        <h1 ref={heading} tabIndex={-1}>
          {membership.shop.name}
        </h1>
        <p>Your role: {membership.role.toLowerCase()}</p>
        <p>Menu slug: {membership.shop.slug}</p>
        <nav className="shop-context-actions" aria-label="Shop actions">
          <Link className="primary-button" to="/app/shops">
            Switch shop
          </Link>
          <Link className="secondary-button" to="/app/account">
            Your account
          </Link>
        </nav>
      </section>
    </main>
  );
}
