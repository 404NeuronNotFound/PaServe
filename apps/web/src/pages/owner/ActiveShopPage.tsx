import { ShopLogo } from "../../components/shops/ShopLogo";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  FiArrowUpRight,
  FiSettings,
  FiUsers,
  FiUser,
} from "react-icons/fi";
import { useActiveShop, shopPath } from "../../features/shops/active-shop";

export function ActiveShopPage() {
  const membership = useActiveShop();
  // Older shops could use these names before they became reserved routes.
  const publicMenuPath = ["menu", "connection"].includes(membership.shop.slug)
    ? `/menu/${encodeURIComponent(membership.shop.slug)}`
    : `/${encodeURIComponent(membership.shop.slug)}`;
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
        <ShopLogo url={membership.shop.logoUrl} name={membership.shop.name} className="shop-overview-emblem" />
      </div>
      <div className="shop-overview-address">
        <span className="section-label">YOUR MENU IDENTITY</span>
        <strong>/{membership.shop.slug}</strong>
        <Link to={publicMenuPath}>View public menu</Link>
      </div>
      <nav className="shop-overview-actions" aria-label="Shop actions">
        {membership.role === "OWNER" && (
          <article className="shop-action-card">
            <span className="shop-action-icon">
              <FiSettings aria-hidden="true" />
            </span>
            <span className="section-label">MAKE IT YOURS</span>
            <strong>Business details</strong>
            <span>
              Business details, contact information, and operating hours.
            </span>
            <Link
              className="primary-button"
              to={`${shopPath(membership.shopId)}/settings`}
            >
              Shop settings
              <FiArrowUpRight aria-hidden="true" />
            </Link>
          </article>
        )}
        <article className="shop-action-card">
          <span className="shop-action-icon">
            <FiUsers aria-hidden="true" />
          </span>
          <span className="section-label">YOUR PEOPLE & PLACES</span>
          <strong>Your places</strong>
          <span>Choose the place you want to manage next.</span>
          <Link className="secondary-button" to="/app/shops">
            Switch shop
            <FiArrowUpRight aria-hidden="true" />
          </Link>
        </article>
        <article className="shop-action-card">
          <span className="shop-action-icon">
            <FiUser aria-hidden="true" />
          </span>
          <span className="section-label">YOUR PERSONAL SPACE</span>
          <strong>Your profile</strong>
          <span>See your profile and all your shop memberships.</span>
          <Link className="secondary-button" to="/app/account">
            Your account
            <FiArrowUpRight aria-hidden="true" />
          </Link>
        </article>
      </nav>
    </section>
  );
}
