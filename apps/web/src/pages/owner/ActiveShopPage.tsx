import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  FiArrowUpRight,
  FiCoffee,
  FiSettings,
  FiUsers,
  FiUser,
} from "react-icons/fi";
import { useActiveShop, shopPath } from "../../features/shops/active-shop";

export function ActiveShopPage() {
  const membership = useActiveShop();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${membership.shop.name} · PaServe`;
    heading.current?.focus();
  }, [membership.shop.name]);
  return (
    <section className="shop-context-content shop-overview">
      <div className="shop-overview-hero">
        <div>
          <p className="section-label">CURRENTLY MANAGING</p>
          <h1 ref={heading} tabIndex={-1}>
            {membership.shop.name}
          </h1>
          <p className="shop-overview-intro">
            Your place. Your people. A better everyday.
          </p>
          <p>Your role: {membership.role.toLowerCase()}</p>
        </div>
        <span className="shop-overview-emblem" aria-hidden="true">
          <FiCoffee />
        </span>
      </div>
      <div className="shop-overview-address">
        <span className="section-label">YOUR MENU IDENTITY</span>
        <strong>/{membership.shop.slug}</strong>
        <span>This address stays with your shop.</span>
      </div>
      <nav className="shop-overview-actions" aria-label="Shop actions">
        {membership.role === "OWNER" && (
          <Link
            className="shop-action-card"
            aria-label="Shop settings"
            to={`${shopPath(membership.shopId)}/settings`}
          >
            <span className="shop-action-icon">
              <FiSettings aria-hidden="true" />
            </span>
            <span className="section-label">MAKE IT YOURS</span>
            <strong>Shop settings</strong>
            <span>
              Business details, contact information, and operating hours.
            </span>
            <FiArrowUpRight className="shop-action-arrow" aria-hidden="true" />
          </Link>
        )}
        <Link
          className="shop-action-card"
          to="/app/shops"
          aria-label="Switch shop"
        >
          <span className="shop-action-icon">
            <FiUsers aria-hidden="true" />
          </span>
          <span className="section-label">YOUR PEOPLE & PLACES</span>
          <strong>Switch shop</strong>
          <span>Choose the place you want to manage next.</span>
          <FiArrowUpRight className="shop-action-arrow" aria-hidden="true" />
        </Link>
        <Link
          className="shop-action-card"
          to="/app/account"
          aria-label="Your account"
        >
          <span className="shop-action-icon">
            <FiUser aria-hidden="true" />
          </span>
          <span className="section-label">YOUR PERSONAL SPACE</span>
          <strong>Your account</strong>
          <span>See your profile and all your shop memberships.</span>
          <FiArrowUpRight className="shop-action-arrow" aria-hidden="true" />
        </Link>
      </nav>
    </section>
  );
}
