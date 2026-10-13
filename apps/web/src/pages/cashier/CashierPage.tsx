import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useActiveShop } from "../../features/shops/active-shop";

export function CashierPage() {
  const membership = useActiveShop();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `Cashier · ${membership.shop.name} · PaServe`;
    heading.current?.focus();
  }, [membership.shop.name]);
  return (
    <section className="shop-context-content">
      <p className="section-label">FRONT COUNTER</p>
      <h1 ref={heading} tabIndex={-1}>
        Cashier workspace
      </h1>
      <p>
        {membership.shop.name} · {membership.role.toLowerCase()}
      </p>
      <p role="status">Your cashier access is verified for this shop.</p>
      <p>
        QR scanning and payment recording will be available in the next cashier
        steps.
      </p>
      <Link className="secondary-button" to="/app/shops">
        Switch shop
      </Link>
    </section>
  );
}
