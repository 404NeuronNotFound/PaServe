import { NavLink, Outlet } from "react-router-dom";
import { shopPath, useActiveShop } from "../../features/shops/active-shop";
import "./active-orders.css";

export function OrdersLayout() {
  const { shopId, role } = useActiveShop();
  const path = `${shopPath(shopId)}/orders`;
  return (
    <>
      {role === "OWNER" && (
        <nav className="owner-orders-navigation" aria-label="Order views">
          <NavLink end to={path}>
            Active orders
          </NavLink>
          <NavLink to={`${path}/completed`}>Completed orders</NavLink>
        </nav>
      )}
      <Outlet />
    </>
  );
}
