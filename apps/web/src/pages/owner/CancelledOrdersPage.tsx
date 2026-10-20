import { Button } from "../../components/ui/button";
import { OrderCard } from "../../components/paserve/OrderCard";
import { OrderListSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentUserResponse } from "@paserve/contracts";
import { FiXCircle, FiClock } from "react-icons/fi";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  cancelledOrdersKey,
  getCancelledOrders,
} from "../../features/orders/cancelled-orders";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ErrorState } from "../../components/feedback/ErrorState";
import { formatCartPrice } from "../../lib/money";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";
import "./active-orders.css";
import { useOrderListSearch } from "../../features/orders/useOrderListSearch";
import { OrderSearch } from "./OrderSearch";
import { OrderEmptyActions } from "./OrderEmptyActions";
import { OrderFilters } from "./OrderFilters";
import {
  OrderPageHeader,
  OrderCardIdentity,
  OrderDetailsLink,
} from "./OrderPresentation";

export function CancelledOrdersPage() {
  const { shopId, role } = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return (
    <CancelledOrdersWorkspace
      key={`${userId}:${shopId}:${role}`}
      userId={userId}
    />
  );
}

function CancelledOrdersWorkspace({ userId }: { userId: string }) {
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
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: cancelledOrdersKey(userId, shopId, cursor, search, filters),
    queryFn: ({ signal }) =>
      getCancelledOrders(shopId, cursor, signal, search, filters),
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
        Only this shop’s owner can view cancelled / rejected orders.
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
      aria-labelledby="cancelled-orders-title"
    >
      <OrderPageHeader
        view="cancelled"
        title="Cancelled / rejected orders"
        titleId="cancelled-orders-title"
        fetching={query.isFetching}
        onRefresh={refresh}
      >
        Review rejected orders and their recorded decision details.
      </OrderPageHeader>
      <div className="owner-order-tools">
        <OrderSearch key={`search:${resetVersion}`} search={search} onSearch={applySearch} />
        <OrderFilters
          key={`filters:${resetVersion}`}
          view="cancelled"
          filters={filters}
          onApply={applyFilters}
        />
      </div>
      <div className="active-orders-toolbar">
        <span>
          <FiClock aria-hidden="true" /> Newest placement first
        </span>
        <span>Updates every 15 seconds · Times in Manila</span>
      </div>
      {query.isPending && (
        <OrderListSkeleton label="Loading cancelled / rejected orders…" />
      )}
      {query.isError && (
        <ErrorState error={query.error} resource="cancelled / rejected orders"
          permissionMessage="Your access to this shop’s orders is unavailable." unavailableMessage="Your access to this shop’s orders is unavailable."
          pending={query.isFetching} onRetry={() => query.refetch()} />
      )}
      {query.isSuccess && (
        <>
          <p className="active-orders-result" role="status">
            Page {cursors.length} · {orders.length}{" "}
            {orders.length === 1 ? "rejected order" : "rejected orders"} on this
            page
          </p>
          {!orders.length ? (
            <div className="active-orders-empty">
              <FiXCircle aria-hidden="true" />
              <h2>
                {search || hasFilters
                  ? cursor
                    ? "No matching orders on this page"
                    : "No matching orders"
                  : cursor
                    ? "No rejected orders on this page"
                    : "No rejected orders yet"}
              </h2>
              <p>
                {search || hasFilters
                  ? "Try another search or adjust or clear the filters."
                  : cursor
                    ? "Go back or refresh to start again."
                    : "Orders rejected before confirmation appear here with any recorded reason and actor."}
              </p>
              <OrderEmptyActions filtered={Boolean(search || hasFilters)} paged={Boolean(cursor)}
                pending={query.isFetching} onReset={clearAll} onRefresh={() => void query.refetch()} />
            </div>
          ) : (
            <ul
              className="active-orders-list"
              aria-label="Cancelled / rejected orders, newest placement first"
            >
              {orders.map((order) => (
                <OrderCard key={order.id} className="active-order-card">
                  <OrderCardIdentity
                    orderNumber={order.orderNumber}
                    mode={order.mode}
                    tableNumber={order.tableNumber}
                  />
                  <div className="active-order-state">
                    <span className="active-order-badge" data-state="REJECTED">
                      Rejected
                    </span>
                    <span className="active-order-payment">Unpaid</span>
                  </div>
                  <dl className="active-order-timing">
                    <div>
                      <dt>Rejected</dt>
                      <dd>
                        {order.decidedAt ? (
                          <time dateTime={order.decidedAt}>
                            {formatReceiptDateTime(order.decidedAt)}
                          </time>
                        ) : (
                          "Not captured"
                        )}
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
                  </dl>
                  <div className="active-order-total">
                    <span>Order total</span>
                    <strong>{formatCartPrice(order.totalPrice)}</strong>
                  </div>
                  <OrderDetailsLink shopId={shopId} orderId={order.id} />
                  <dl className="cancelled-order-decision">
                    <div>
                      <dt>Reason</dt>
                      <dd>{order.rejectionReason ?? "Not captured"}</dd>
                    </div>
                    <div>
                      <dt>Recorded actor ID</dt>
                      <dd>{order.decidedBy ?? "Not captured"}</dd>
                    </div>
                  </dl>
                </OrderCard>
              ))}
            </ul>
          )}
        </>
      )}
      <nav
        className="active-orders-pagination"
        aria-label="Cancelled / rejected orders pagination"
      >
        <Button variant="outline" size="inherit" type="submit"
          className="secondary-button"
          disabled={cursors.length === 1 || query.isFetching}
          onClick={() => setCursors((values) => values.slice(0, -1))}
        >
          Previous
        </Button>
        <span>Page {cursors.length}</span>
        <Button variant="outline" size="inherit" type="submit"
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
        </Button>
      </nav>
    </section>
  );
}
