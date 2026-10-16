import { Outlet } from "react-router-dom";
import "./active-orders.css";

export function OrdersLayout() {
  return (
    <div className="owner-orders-shell">
      <Outlet />
    </div>
  );
}
