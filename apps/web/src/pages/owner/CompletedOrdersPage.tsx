import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type {
  CompletedOrderSummary,
  CurrentUserResponse,
} from "@paserve/contracts";
import { FiArchive, FiClock } from "react-icons/fi";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  completedOrdersKey,
  getCompletedOrders,
} from "../../features/orders/completed-orders";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { formatCartPrice } from "../../lib/money";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";
import { sumPrices } from "../../features/cart/cart";
import "./active-orders.css";
import { useOrderListSearch } from "../../features/orders/useOrderListSearch";
import { OrderSearch } from "./OrderSearch";
import { OrderFilters } from "./OrderFilters";
import {
  OrderPageHeader,
  OrderCardIdentity,
  OrderDetailsLink,
} from "./OrderPresentation";

const paymentLabels: Record<CompletedOrderSummary["paymentMethod"], string> = {
  CASH: "Cash",
  GCASH_MANUAL: "GCash (manual)",
  CARD_MANUAL: "Card (manual)",
  OTHER: "Other",
};

export function CompletedOrdersPage() {
  const { shopId, role } = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return (
    <CompletedOrdersWorkspace
      key={`${userId}:${shopId}:${role}`}
      userId={userId}
    />
  );
}

function CompletedOrdersWorkspace({ userId }: { userId: string }) {
  const { shopId, role } = useActiveShop();
  const {
    search,
    filters,
    hasFilters,
    cursors,
    setCursors,
    applySearch,
    applyFilters,
  } = useOrderListSearch();
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: completedOrdersKey(userId, shopId, cursor, search, filters),
    queryFn: ({ signal }) =>
      getCompletedOrders(shopId, cursor, signal, search, filters),
    enabled: role === "OWNER",
    retry: false,
    networkMode: "always",
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 15000,
  });
  if (role !== "OWNER")
    return (
      <InlineMessage>
        Only this shop’s owner can view completed orders.
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
      aria-labelledby="completed-orders-title"
    >
      <OrderPageHeader
        view="completed"
        title="Completed orders"
        titleId="completed-orders-title"
        fetching={query.isFetching}
        onRefresh={refresh}
      >
        Review fulfilled orders with their saved totals and payment records.
      </OrderPageHeader>
      <div className="owner-order-tools">
        <OrderSearch search={search} onSearch={applySearch} />
        <OrderFilters
          view="completed"
          filters={filters}
          onApply={applyFilters}
        />
      </div>
      <div className="active-orders-toolbar">
        <span>
          <FiClock aria-hidden="true" /> Newest completions first
        </span>
        <span>Updates every 15 seconds · Times in Manila</span>
      </div>
      {query.isPending && (
        <InlineMessage tone="info">Loading completed orders…</InlineMessage>
      )}
      {query.isError && (
        <div className="active-orders-message">
          <InlineMessage>
            {denied
              ? "Your access to this shop’s orders is unavailable."
              : "We couldn’t refresh completed orders. Retry to load the saved history."}
          </InlineMessage>
          <button
            className="secondary-button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {query.isSuccess && (
        <>
          <div className="completed-orders-summary">
            <p className="active-orders-result" role="status">
              Page {cursors.length} · {orders.length}{" "}
              {orders.length === 1 ? "completed order" : "completed orders"} on
              this page
            </p>
            <p>
              Total on this page{" "}
              <strong>
                {formatCartPrice(
                  sumPrices(orders.map((order) => order.totalPrice)),
                )}
              </strong>
            </p>
          </div>
          {!orders.length ? (
            <div className="active-orders-empty">
              <FiArchive aria-hidden="true" />
              <h2>
                {search || hasFilters
                  ? cursor
                    ? "No matching orders on this page"
                    : "No matching orders"
                  : cursor
                    ? "No completed orders on this page"
                    : "No completed orders yet"}
              </h2>
              <p>
                {search || hasFilters
                  ? "Try another search or adjust or clear the filters."
                  : cursor
                    ? "Go back or refresh to start again."
                    : "Orders appear here after your team confirms pickup or table service. Payment alone does not mark an order fulfilled."}
              </p>
            </div>
          ) : (
            <ul
              className="active-orders-list"
              aria-label="Completed orders, newest completion first"
            >
              {orders.map((order) => (
                <li key={order.id} className="active-order-card">
                  <OrderCardIdentity
                    orderNumber={order.orderNumber}
                    mode={order.mode}
                    tableNumber={order.tableNumber}
                  />
                  <div className="active-order-state">
                    <span className="active-order-badge" data-state="COMPLETED">
                      Fulfilled
                    </span>
                    <span className="active-order-payment">
                      Confirmed · Paid
                    </span>
                    <span className="active-order-payment">
                      {paymentLabels[order.paymentMethod]}
                    </span>
                  </div>
                  <dl className="active-order-timing">
                    <div>
                      <dt>Completed</dt>
                      <dd>
                        <time dateTime={order.completedAt}>
                          {formatReceiptDateTime(order.completedAt)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt>Placed</dt>
                      <dd>
                        <time dateTime={order.createdAt}>
                          {formatReceiptDateTime(order.createdAt)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt>Paid</dt>
                      <dd>
                        <time dateTime={order.paidAt}>
                          {formatReceiptDateTime(order.paidAt)}
                        </time>
                      </dd>
                    </div>
                  </dl>
                  <div className="active-order-total">
                    <span>Saved total</span>
                    <strong>{formatCartPrice(order.totalPrice)}</strong>
                  </div>
                  <OrderDetailsLink
                    shopId={shopId}
                    orderId={order.id}
                    receipt
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <nav
        className="active-orders-pagination"
        aria-label="Completed orders pagination"
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
