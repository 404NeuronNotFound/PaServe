import type { ReactNode } from "react";
import type { ActiveOrderSummary } from "@paserve/contracts";
import { OrderViewsNavigation } from "./OrderViewsNavigation";
import {
  FiArrowUpRight,
  FiCheckCircle,
  FiClock,
  FiGrid,
  FiRefreshCw,
  FiShoppingBag,
  FiSlash,
} from "react-icons/fi";

const viewIcons = {
  active: FiShoppingBag,
  completed: FiCheckCircle,
  cancelled: FiSlash,
};

export function OrderPageHeader({
  view,
  title,
  titleId,
  children,
  fetching,
  onRefresh,
}: {
  view: keyof typeof viewIcons;
  title: string;
  titleId: string;
  children: ReactNode;
  fetching: boolean;
  onRefresh: () => void;
}) {
  const Icon = viewIcons[view];
  return (
    <>
      <header className="active-orders-header">
        <div className="owner-orders-heading">
          <span className="owner-orders-emblem">
            <Icon aria-hidden="true" />
          </span>
          <div>
            <p className="section-label">ORDER MANAGEMENT</p>
            <h1 id={titleId}>{title}</h1>
            <p>{children}</p>
          </div>
        </div>
        <button
          className="secondary-button owner-orders-refresh"
          disabled={fetching}
          onClick={onRefresh}
        >
          <FiRefreshCw
            aria-hidden="true"
            className={fetching ? "is-refreshing" : undefined}
          />
          {fetching ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      <OrderViewsNavigation />
    </>
  );
}

export function OrderCardIdentity({
  orderNumber,
  mode,
  tableNumber,
}: {
  orderNumber: string;
  mode: "DINE_IN" | "TAKEOUT";
  tableNumber: string | null;
}) {
  const Icon = mode === "TAKEOUT" ? FiShoppingBag : FiGrid;
  return (
    <div className="active-order-identity">
      <span className="owner-order-type-icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <span className="owner-order-eyebrow">ORDER</span>
        <h2>{orderNumber}</h2>
        <p>
          {mode === "TAKEOUT" ? "Takeout" : `Dine-in · Table ${tableNumber}`}
        </p>
      </div>
    </div>
  );
}

export function OrderDetailsLink({
  shopId,
  orderId,
  receipt = false,
}: {
  shopId: string;
  orderId: string;
  receipt?: boolean;
}) {
  return (
    <a
      className="owner-order-detail-link"
      data-receipt={receipt || undefined}
      href={`/app/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}`}
    >
      <span>{receipt ? "View details / receipt" : "View details"}</span>
      <FiArrowUpRight aria-hidden="true" />
    </a>
  );
}

export function ActiveOrdersPulse({
  orders,
}: {
  orders: ActiveOrderSummary[];
}) {
  const pending = orders.filter(
    (order) => order.paymentStatus === "UNPAID",
  ).length;
  const preparing = orders.filter(
    (order) =>
      order.preparationStatus === "QUEUED" ||
      order.preparationStatus === "PREPARING",
  ).length;
  const ready = orders.filter(
    (order) => order.preparationStatus === "READY",
  ).length;
  return (
    <aside className="owner-orders-pulse" aria-label="Current page overview">
      <div className="owner-orders-pulse-intro">
        <span className="owner-orders-pulse-icon">
          <FiClock aria-hidden="true" />
        </span>
        <div>
          <strong>Service at a glance</strong>
          <span>
            Current page · {orders.length}{" "}
            {orders.length === 1 ? "order" : "orders"}
          </span>
        </div>
      </div>
      <dl>
        <div>
          <dt>Awaiting confirmation / payment</dt>
          <dd>{pending.toString().padStart(2, "0")}</dd>
        </div>
        <div>
          <dt>In the kitchen</dt>
          <dd>{preparing.toString().padStart(2, "0")}</dd>
        </div>
        <div>
          <dt>Ready to serve</dt>
          <dd>{ready.toString().padStart(2, "0")}</dd>
        </div>
      </dl>
    </aside>
  );
}
