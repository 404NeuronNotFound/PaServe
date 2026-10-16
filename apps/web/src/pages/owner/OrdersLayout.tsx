import { NavLink, Outlet } from "react-router-dom";
import { FiActivity, FiCheckCircle, FiSlash } from "react-icons/fi";
import { shopPath, useActiveShop } from "../../features/shops/active-shop";
import "./active-orders.css";

export function OrdersLayout() {
  const { shopId, role } = useActiveShop();
  const path = `${shopPath(shopId)}/orders`;
  return (
    <div className="owner-orders-shell">
      {role === "OWNER" && (
        <nav className="owner-orders-navigation" aria-label="Order views">
          <NavLink end to={path}>
            <FiActivity aria-hidden="true" /> Active orders
          </NavLink>
          <NavLink to={`${path}/completed`}>
            <FiCheckCircle aria-hidden="true" /> Completed orders
          </NavLink>
          <NavLink to={`${path}/cancelled`}>
            <FiSlash aria-hidden="true" /> Cancelled / rejected
          </NavLink>
        </nav>
      )}
      <Outlet />
    </div>
  );
}
