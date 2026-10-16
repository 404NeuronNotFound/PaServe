import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  hasShopPermission,
  salesBusinessDate,
  salesBusinessDayBounds,
  type CurrentUserResponse,
} from "@paserve/contracts";
import {
  FiBarChart2,
  FiClipboard,
  FiShoppingBag,
  FiRefreshCw,
  FiTrendingUp,
} from "react-icons/fi";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getDailySales } from "../../features/orders/daily-sales";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { calculateAverageOrderValue, formatCartPrice } from "../../lib/money";
import "./sales-dashboard.css";

export function SalesDashboardPage() {
  const { shopId, role } = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return <SalesWorkspace key={`${userId}:${shopId}:${role}`} userId={userId} />;
}

function SalesWorkspace({ userId }: { userId: string }) {
  const { shopId, role } = useActiveShop();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [today, setToday] = useState(() => salesBusinessDate());
  useEffect(() => {
    const update = () => setToday(salesBusinessDate());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const date = selectedDate ?? today;
  const allowed = hasShopPermission(role, "shop.reports.read");
  const valid = !!salesBusinessDayBounds(date);
  const query = useQuery({
    queryKey: ["daily-sales", userId, shopId, date],
    queryFn: ({ signal }) => getDailySales(shopId, date, signal),
    enabled: allowed && valid,
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  if (!allowed)
    return (
      <InlineMessage>
        Your role does not allow access to this shop’s sales reports.
      </InlineMessage>
    );
  const denied =
    isAxiosError(query.error) &&
    [401, 403, 404].includes(query.error.response?.status ?? 0);
  return (
    <section className="sales-dashboard" aria-labelledby="sales-title">
      <header className="sales-header">
        <div>
          <p className="section-label">DAILY PERFORMANCE</p>
          <h1 id="sales-title">Sales dashboard</h1>
          <p>Sales and eligible orders for your selected business day.</p>
        </div>
        <button
          className="secondary-button"
          disabled={!valid || query.isFetching}
          onClick={() => void query.refetch()}
        >
          <FiRefreshCw aria-hidden="true" /> Refresh sales
        </button>
      </header>
      <div className="sales-date-controls">
        <label htmlFor="sales-date">
          Business date
          <input
            id="sales-date"
            type="date"
            value={date}
            aria-describedby="sales-timezone"
            onChange={(event) =>
              setSelectedDate(
                event.target.value === today ? null : event.target.value,
              )
            }
          />
        </label>
        <button
          className="secondary-button"
          onClick={() => {
            setToday(salesBusinessDate());
            setSelectedDate(null);
          }}
        >
          Today
        </button>
        <p id="sales-timezone">
          Asia/Manila (UTC+8) · Midnight inclusive to next midnight exclusive.
        </p>
      </div>
      {!valid ? (
        <InlineMessage>Choose a valid business date.</InlineMessage>
      ) : (
        <>
          {query.isPending && (
            <InlineMessage tone="info">Loading sales…</InlineMessage>
          )}
          {query.isError && (
            <div>
              <InlineMessage>
                {denied
                  ? "Your access to this shop’s sales reports is unavailable."
                  : "We couldn’t refresh sales. Retry to load the saved total."}
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
            <div className="sales-metrics" aria-busy={query.isFetching}>
              <article
                className="sales-total"
                aria-labelledby="sales-total-label"
                aria-busy={query.isFetching}
              >
                <FiTrendingUp aria-hidden="true" />
                <p id="sales-total-label" className="section-label">
                  {date === today ? "Today’s Sales" : "Gross Sales"}
                </p>
                <p className="sales-business-date">{date} · Asia/Manila</p>
                <strong className="sales-amount">
                  {formatCartPrice(query.data.totalSales)}
                </strong>
                {query.data.completedOrders === 0 && (
                  <p>No eligible completed orders for this business day.</p>
                )}
                <p>
                  Saved totals from confirmed, paid and completed orders,
                  counted by completion time.
                </p>
                <p className="sales-updated">
                  Updated{" "}
                  {new Intl.DateTimeFormat("en-PH", {
                    timeZone: "Asia/Manila",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(query.dataUpdatedAt)}{" "}
                  · Refreshes every 15 seconds
                </p>
              </article>
              <article
                className="sales-total"
                aria-labelledby="sales-orders-label"
              >
                <FiClipboard aria-hidden="true" />
                <h2 id="sales-orders-label" className="section-label">
                  Number of Orders
                </h2>
                <p className="sales-business-date">{date} · Asia/Manila</p>
                <strong className="sales-amount">
                  {new Intl.NumberFormat("en-PH").format(
                    query.data.completedOrders,
                  )}
                </strong>
                <p>
                  Confirmed, paid and completed orders in this business day,
                  counted once per order by completion time.
                </p>
                {query.data.completedOrders === 0 && (
                  <p>No eligible orders for this business day.</p>
                )}
              </article>
              <article
                className="sales-total"
                aria-labelledby="sales-average-label"
              >
                <FiBarChart2 aria-hidden="true" />
                <h2 id="sales-average-label" className="section-label">
                  Average Order Value
                </h2>
                <p className="sales-business-date">{date} · Asia/Manila</p>
                <strong className="sales-amount">
                  {formatCartPrice(
                    calculateAverageOrderValue(
                      query.data.totalSales,
                      query.data.completedOrders,
                    ),
                  )}
                </strong>
                <p>
                  Gross sales divided by eligible orders, rounded to the nearest
                  cent.
                </p>
                {query.data.completedOrders === 0 && (
                  <p>No eligible orders; average is ₱0.00.</p>
                )}
              </article>
              <article
                className="sales-total"
                aria-labelledby="sales-items-label"
              >
                <FiShoppingBag aria-hidden="true" />
                <h2 id="sales-items-label" className="section-label">
                  Items Sold
                </h2>
                <p className="sales-business-date">{date} · Asia/Manila</p>
                <strong className="sales-amount">
                  {new Intl.NumberFormat("en-PH").format(query.data.itemsSold)}
                </strong>
                <p>
                  Total item quantities from eligible completed orders. Options
                  and add-ons are included with their item.
                </p>
                {query.data.completedOrders === 0 && (
                  <p>No eligible items for this business day.</p>
                )}
              </article>
            </div>
          )}
          {query.isSuccess && (
            <section
              className="sales-payment-breakdown"
              aria-labelledby="sales-payments-title"
              aria-busy={query.isFetching}
            >
              <h2 id="sales-payments-title">Payment Breakdown</h2>
              <p className="sales-business-date">{date} · Asia/Manila</p>
              <p>
                Eligible completed orders by recorded payment method. Cash
                totals exclude change.
              </p>
              {query.data.completedOrders === 0 && (
                <p>No eligible payments for this business day.</p>
              )}
              <table>
                <caption className="sales-payment-caption">
                  Sales and order counts by payment method
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Payment method</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.paymentBreakdown.map((entry) => (
                    <tr key={entry.paymentMethod}>
                      <th scope="row">
                        {
                          {
                            CASH: "Cash",
                            GCASH_MANUAL: "GCash (manual)",
                            CARD_MANUAL: "Card (manual)",
                            OTHER: "Other",
                          }[entry.paymentMethod]
                        }
                      </th>
                      <td>
                        {new Intl.NumberFormat("en-PH").format(entry.orders)}
                      </td>
                      <td>{formatCartPrice(entry.totalSales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
      <p className="sales-definition">
        Gross sales include all recorded payment methods. Refunds and expenses
        are not deducted. Cash change is excluded.
      </p>
    </section>
  );
}
