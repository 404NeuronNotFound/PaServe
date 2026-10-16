import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type {
  CurrentUserResponse,
  ActiveOrderSummary,
} from "@paserve/contracts";
import { FiClock, FiRefreshCw, FiShoppingBag } from "react-icons/fi";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  activeOrdersKey,
  getActiveOrders,
} from "../../features/orders/active-orders";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { formatCartPrice } from "../../lib/money";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";
import "./active-orders.css";

export function ActiveOrdersPage() {
  const membership = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return (
    <ActiveOrdersWorkspace
      key={`${userId}:${membership.shopId}:${membership.role}`}
      userId={userId}
    />
  );
}

function statusLabel(order: ActiveOrderSummary) {
  if (order.status === "PENDING_CONFIRMATION") return "Pending confirmation";
  if (order.paymentStatus === "UNPAID") return "Awaiting payment";
  if (order.preparationStatus === null) return "Awaiting preparation";
  return { QUEUED: "Queued", PREPARING: "Preparing", READY: "Ready" }[
    order.preparationStatus
  ];
}

function elapsed(createdAt: string, now: number) {
  const minutes = Math.max(
    0,
    Math.floor((now - Date.parse(createdAt)) / 60000),
  );
  if (!minutes) return "Less than a minute ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${minutes % 60} min ago`;
  return `${Math.floor(hours / 24)} d ${hours % 24} hr ago`;
}

function ActiveOrdersWorkspace({ userId }: { userId: string }) {
  const { shopId, role } = useActiveShop();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [now, setNow] = useState(Date.now);
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: activeOrdersKey(userId, shopId, cursor),
    queryFn: ({ signal }) => getActiveOrders(shopId, cursor, signal),
    enabled: role === "OWNER",
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 15000,
  });
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(interval);
  }, []);
  if (role !== "OWNER")
    return (
      <InlineMessage>
        Only this shop’s owner can view active orders.
      </InlineMessage>
    );
  const denied =
    isAxiosError(query.error) &&
    [401, 403, 404].includes(query.error.response?.status ?? 0);
  const orders = query.isSuccess ? query.data.orders : [];
  const refresh = () => {
    if (cursor) setCursors([null]);
    else void query.refetch();
  };
  return (
    <section
      className="active-orders-workspace"
      aria-labelledby="active-orders-title"
    >
      <header className="active-orders-header">
        <div>
          <p className="section-label">ORDER MANAGEMENT</p>
          <h1 id="active-orders-title">Active orders</h1>
          <p>
            Follow every order from confirmation to pickup or table service.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={query.isFetching}
          onClick={refresh}
        >
          <FiRefreshCw aria-hidden="true" />
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      <div className="active-orders-toolbar">
        <span>
          <FiClock aria-hidden="true" /> Oldest orders first
        </span>
        <span>Updates every 15 seconds · Times in Manila</span>
      </div>
      {query.isPending && (
        <InlineMessage tone="info">Loading active orders…</InlineMessage>
      )}
      {query.isError && (
        <div className="active-orders-message">
          <InlineMessage>
            {denied
              ? "Your access to this shop’s orders is unavailable."
              : "We couldn’t refresh active orders. Retry to get the current status."}
          </InlineMessage>
          <button
            className="secondary-button"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {query.isSuccess && (
        <>
          <p className="active-orders-result" role="status">
            Page {cursors.length} · {orders.length}{" "}
            {orders.length === 1 ? "active order" : "active orders"} on this
            page
          </p>
          {!orders.length ? (
            <div className="active-orders-empty">
              <FiShoppingBag aria-hidden="true" />
              <h2>
                {cursor
                  ? "No active orders on this page"
                  : "No active orders right now"}
              </h2>
              <p>
                {cursor
                  ? "Orders may have been fulfilled. Go back or refresh to start again."
                  : "New orders will appear here while they await confirmation, payment, preparation, or fulfillment."}
              </p>
            </div>
          ) : (
            <ul
              className="active-orders-list"
              aria-label="Active orders, oldest first"
            >
              {orders.map((order) => (
                <li key={order.id} className="active-order-card">
                  <div className="active-order-identity">
                    <h2>{order.orderNumber}</h2>
                    <p>
                      {order.mode === "TAKEOUT"
                        ? "Takeout"
                        : `Dine-in · Table ${order.tableNumber}`}
                    </p>
                  </div>
                  <div className="active-order-state">
                    <span
                      className="active-order-badge"
                      data-state={order.preparationStatus ?? order.status}
                    >
                      {statusLabel(order)}
                    </span>
                    <span className="active-order-payment">
                      {order.status === "CONFIRMED" ? "Confirmed · " : ""}
                      {order.paymentStatus === "PAID" ? "Paid" : "Unpaid"}
                    </span>
                  </div>
                  <dl className="active-order-timing">
                    <div>
                      <dt>Placed</dt>
                      <dd>
                        <time dateTime={order.createdAt}>
                          {formatReceiptDateTime(order.createdAt)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>
                        <time dateTime={order.updatedAt}>
                          {formatReceiptDateTime(order.updatedAt)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt>Order age</dt>
                      <dd>{elapsed(order.createdAt, now)}</dd>
                    </div>
                  </dl>
                  <div className="active-order-total">
                    <span>Total</span>
                    <strong>{formatCartPrice(order.totalPrice)}</strong>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <nav
        className="active-orders-pagination"
        aria-label="Active orders pagination"
      >
        <button
          className="secondary-button"
          disabled={cursors.length === 1 || query.isFetching}
          onClick={() => setCursors((values) => values.slice(0, -1))}
        >
          Previous
        </button>
        <span>Page {cursors.length}</span>
        <button
          className="secondary-button"
          disabled={
            !query.isSuccess || !query.data.nextCursor || query.isFetching
          }
          onClick={() => {
            if (query.isSuccess && query.data.nextCursor)
              setCursors((values) => [...values, query.data.nextCursor]);
          }}
        >
          Next
        </button>
      </nav>
    </section>
  );
}
