import { ListPagination } from "../../components/paserve/ListPagination";
import { StatusBadge } from "../../components/paserve/StatusBadge";
import { OrderCard } from "../../components/paserve/OrderCard";
import { OrderListSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CurrentUserResponse,
  ActiveOrderSummary,
} from "@paserve/contracts";
import { FiClock, FiShoppingBag } from "react-icons/fi";
import {
  ActiveOrdersPulse,
  OrderPageHeader,
  OrderCardIdentity,
  OrderDetailsLink,
} from "./OrderPresentation";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  activeOrdersKey,
  getActiveOrders,
} from "../../features/orders/active-orders";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ErrorState } from "../../components/feedback/ErrorState";
import { formatCartPrice } from "../../lib/money";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";
import "./active-orders.css";
import { useOrderListSearch } from "../../features/orders/useOrderListSearch";
import { OrderSearch } from "./OrderSearch";
import { OrderEmptyActions } from "./OrderEmptyActions";
import { OrderFilters } from "./OrderFilters";

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
  const {
    search,
    filters,
    hasFilters,
    cursors,
    setCursors,
    applySearch,
    applyFilters,
    clearAll,
    resetVersion,
  } = useOrderListSearch();
  const [now, setNow] = useState(Date.now);
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: activeOrdersKey(userId, shopId, cursor, search, filters),
    queryFn: ({ signal }) =>
      getActiveOrders(shopId, cursor, signal, search, filters),
    enabled: role === "OWNER",
    retry: false,
    networkMode: "always",
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
      <OrderPageHeader
        view="active"
        title="Active orders"
        titleId="active-orders-title"
        fetching={query.isFetching}
        onRefresh={refresh}
      >
        Follow every order from confirmation to pickup or table service.
      </OrderPageHeader>
      {query.isSuccess && orders.length > 0 && (
        <ActiveOrdersPulse orders={orders} />
      )}
      <div className="owner-order-tools">
        <OrderSearch key={`search:${resetVersion}`} search={search} onSearch={applySearch} />
        <OrderFilters key={`filters:${resetVersion}`} view="active" filters={filters} onApply={applyFilters} />
      </div>
      <div className="active-orders-toolbar">
        <span>
          <FiClock aria-hidden="true" /> Oldest orders first
        </span>
        <span>Updates every 15 seconds · Times in Manila</span>
      </div>
      {query.isPending && (
        <OrderListSkeleton label="Loading active orders…" />
      )}
      {query.isError && (
        <ErrorState error={query.error} resource="active orders"
          permissionMessage="Your access to this shop’s orders is unavailable." unavailableMessage="Your access to this shop’s orders is unavailable."
          pending={query.isFetching} onRetry={() => query.refetch()} />
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
                {search || hasFilters
                  ? cursor
                    ? "No matching orders on this page"
                    : "No matching orders"
                  : cursor
                    ? "No active orders on this page"
                    : "No active orders right now"}
              </h2>
              <p>
                {search || hasFilters
                  ? "Try another search or adjust or clear the filters."
                  : cursor
                    ? "Orders may have been fulfilled. Go back or refresh to start again."
                    : "New orders will appear here while they await confirmation, payment, preparation, or fulfillment."}
              </p>
              <OrderEmptyActions filtered={Boolean(search || hasFilters)} paged={Boolean(cursor)}
                pending={query.isFetching} onReset={clearAll} onRefresh={() => void query.refetch()} />
            </div>
          ) : (
            <ul
              className="active-orders-list"
              aria-label="Active orders, oldest first"
            >
              {orders.map((order) => (
                <OrderCard key={order.id} className="active-order-card">
                  <OrderCardIdentity
                    orderNumber={order.orderNumber}
                    mode={order.mode}
                    tableNumber={order.tableNumber}
                  />
                  <div className="active-order-state">
                    <StatusBadge
                      className="active-order-badge"
                      state={order.status === "PENDING_CONFIRMATION" ? order.status
                        : order.paymentStatus === "UNPAID" ? "UNPAID"
                        : order.preparationStatus ?? "NOT_STARTED"}
                      data-payment={order.paymentStatus}
                    >
                      {statusLabel(order)}
                    </StatusBadge>
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
                  <OrderDetailsLink shopId={shopId} orderId={order.id} />
                </OrderCard>
              ))}
            </ul>
          )}
        </>
      )}
      <ListPagination
        label="Active orders pagination"
        className="active-orders-pagination"
        page={cursors.length}
        hasNext={Boolean(query.isSuccess && query.data.nextCursor)}
        pending={query.isFetching}
        onPrevious={() => setCursors((values) => values.slice(0, -1))}
        onNext={() => {
          if (query.isSuccess && query.data.nextCursor)
            setCursors((values) => [...values, query.data.nextCursor]);
        }}
      />
    </section>
  );
}
