import { RefreshButton } from "../../components/feedback/RefreshButton";
import { useNumberedHistory } from "../../features/orders/useNumberedHistory";
import { StatusBadge } from "../../components/paserve/StatusBadge";
import { ListPagination } from "../../components/paserve/ListPagination";
import { OrderCard } from "../../components/paserve/OrderCard";
import { OrderListSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ErrorState } from "../../components/feedback/ErrorState";
import { formatCartPrice } from "../../lib/money";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";
import { sumPrices } from "../../features/cart/cart";
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
    applySearch,
    applyFilters,
    clearAll,
    resetVersion,
  } = useOrderListSearch();
  const paging = useNumberedHistory(JSON.stringify([search, filters, resetVersion]));
  const query = useQuery({
    queryKey: [...completedOrdersKey(userId, shopId, null, search, filters), ...paging.key],
    queryFn: ({ signal }) =>
      paging.load((request) => getCompletedOrders(shopId, null, signal, search, filters, request)),
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
  const orders = query.isSuccess ? query.data.orders : [];
  const refresh = paging.refresh;
  const page = query.data?.pagination?.page ?? paging.page;
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
      {query.isSuccess && query.data.pagination?.hasNew && (
        <InlineMessage tone="info">New orders available. <RefreshButton label="Show new orders" onClick={refresh} pending={query.isFetching} /></InlineMessage>
      )}
      <div className="owner-order-tools">
        <OrderSearch key={`search:${resetVersion}`} search={search} onSearch={applySearch} />
        <OrderFilters
          key={`filters:${resetVersion}`}
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
        <OrderListSkeleton label="Loading completed orders…" />
      )}
      {query.isError && (
        <ErrorState error={query.error} resource="completed orders"
          permissionMessage="Your access to this shop’s orders is unavailable." unavailableMessage="Your access to this shop’s orders is unavailable."
          pending={query.isFetching} onRetry={() => query.refetch()} />
      )}
      {query.isSuccess && (
        <>
          <div className="completed-orders-summary">
            <p className="active-orders-result" role="status">
              Page {page} · {orders.length}{" "}
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
                  ? (page > 1)
                    ? "No matching orders on this page"
                    : "No matching orders"
                  : (page > 1)
                    ? "No completed orders on this page"
                    : "No completed orders yet"}
              </h2>
              <p>
                {search || hasFilters
                  ? "Try another search or adjust or clear the filters."
                  : (page > 1)
                    ? "Go back or refresh to start again."
                    : "Orders appear here after your team confirms pickup or table service. Payment alone does not mark an order fulfilled."}
              </p>
              <OrderEmptyActions filtered={Boolean(search || hasFilters)} paged={Boolean((page > 1))}
                pending={query.isFetching} onReset={clearAll} onRefresh={refresh} />
            </div>
          ) : (
            <ul
              className="active-orders-list"
              aria-label="Completed orders, newest completion first"
            >
              {orders.map((order) => (
                <OrderCard key={order.id} className="active-order-card">
                  <OrderCardIdentity
                    orderNumber={order.orderNumber}
                    mode={order.mode}
                    tableNumber={order.tableNumber}
                    serviceType={order.serviceType}
                  />
                  <div className="active-order-state">
                    <StatusBadge className="active-order-badge" state="COMPLETED">
                      Fulfilled
                    </StatusBadge>
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
                </OrderCard>
              ))}
            </ul>
          )}
        </>
      )}
      <ListPagination
        label="Completed orders pagination"
        className="active-orders-pagination"
        page={page}
        pageCount={query.isSuccess ? query.data.pagination?.pageCount : undefined}
        hasNext={Boolean(query.isSuccess && query.data.pagination && page < query.data.pagination.pageCount)}
        pending={query.isFetching}
        onPage={paging.go}
        onPrevious={() => paging.go(page - 1)}
        onNext={() => paging.go(page + 1)}
      />
    </section>
  );
}
