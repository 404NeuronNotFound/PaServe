import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  hasShopPermission,
  salesBusinessDate,
  salesBusinessDayBounds,
  type CurrentUserResponse,
  type PaymentBreakdownEntry,
} from "@paserve/contracts";
import {
  FiArrowUpRight,
  FiBarChart2,
  FiCalendar,
  FiCheck,
  FiChevronDown,
  FiClipboard,
  FiClock,
  FiCreditCard,
  FiRefreshCw,
  FiShoppingBag,
  FiTrendingUp,
} from "react-icons/fi";
import type { IconType } from "react-icons";
import { shopPath, useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getDailySales } from "../../features/orders/daily-sales";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { calculateAverageOrderValue, formatCartPrice } from "../../lib/money";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";
import "./sales-dashboard.css";

const paymentLabels = {
  CASH: "Cash",
  GCASH_MANUAL: "GCash (manual)",
  CARD_MANUAL: "Card (manual)",
  OTHER: "Other",
};
const countFormat = new Intl.NumberFormat("en-PH");
const dateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const updateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function reportAccessUnavailable(error: unknown) {
  return (
    isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0)
  );
}

/** Bounded ratio for drawing only; displayed monetary values remain exact strings. */
function paymentShares(entries: PaymentBreakdownEntry[], total: string) {
  const cents = BigInt(total.replace(".", ""));
  let offset = 0;
  return entries.map((entry) => {
    const share =
      cents === 0n
        ? 0
        : Number(
            (BigInt(entry.totalSales.replace(".", "")) * 1_000_000n) / cents,
          ) / 10_000;
    const segment = { ...entry, share, offset };
    offset += share;
    return segment;
  });
}

function Metric({
  id,
  title,
  value,
  note,
  Icon,
  number,
}: {
  id: string;
  title: string;
  value: string;
  note: string;
  Icon: IconType;
  number: string;
}) {
  return (
    <article className="sales-metric" aria-labelledby={id}>
      <div className="sales-metric-top">
        <span className="sales-metric-icon">
          <Icon aria-hidden="true" />
        </span>
        <span className="sales-metric-index" aria-hidden="true">
          {number}
        </span>
      </div>
      <h2 id={id}>{title}</h2>
      <strong className="sales-amount">{value}</strong>
      <p>{note}</p>
    </article>
  );
}

export function SalesDashboardPage() {
  const { shopId, role } = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return <SalesWorkspace key={`${userId}:${shopId}:${role}`} userId={userId} />;
}

function SalesWorkspace({ userId }: { userId: string }) {
  const { shopId, role, shop } = useActiveShop();
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
    refetchInterval: (reportQuery) =>
      reportAccessUnavailable(reportQuery.state.error) ? false : 15000,
    refetchOnWindowFocus: (reportQuery) =>
      !reportAccessUnavailable(reportQuery.state.error),
    refetchOnReconnect: (reportQuery) =>
      !reportAccessUnavailable(reportQuery.state.error),
  });
  if (!allowed)
    return (
      <InlineMessage>
        Your role does not allow access to this shop’s sales reports.
      </InlineMessage>
    );
  const denied = reportAccessUnavailable(query.error);
  const report = query.isSuccess && valid ? query.data : null;
  const segments = report
    ? paymentShares(report.paymentBreakdown, report.totalSales)
    : [];
  const prettyDate = valid
    ? dateFormat.format(new Date(`${date}T00:00:00+08:00`))
    : "Choose a date";

  return (
    <section className="sales-dashboard" aria-labelledby="sales-title">
      <header className="sales-header">
        <div>
          <p className="sales-eyebrow">
            <span aria-hidden="true" /> THE BUSINESS OF A GOOD DAY
          </p>
          <h1 id="sales-title">
            Sales dashboard<span aria-hidden="true">.</span>
          </h1>
          <p className="sales-intro">
            A little clarity for your everyday. <strong>{shop.name}</strong>
          </p>
        </div>
        <button
          className="secondary-button sales-refresh"
          disabled={!valid || query.isFetching}
          onClick={() => void query.refetch()}
        >
          <FiRefreshCw
            aria-hidden="true"
            className={query.isFetching ? "sales-refreshing" : undefined}
          />{" "}
          Refresh sales
        </button>
      </header>
      <div className="sales-toolbar">
        <div className="sales-period">
          <FiCalendar aria-hidden="true" />
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
            className="sales-today"
            aria-pressed={date === today}
            onClick={() => {
              setToday(salesBusinessDate());
              setSelectedDate(null);
            }}
          >
            Today
          </button>
        </div>
        <span id="sales-timezone" className="sales-timezone">
          Manila <span>UTC+8</span>
        </span>
        <p className="sales-sync">
          <FiClock aria-hidden="true" />
          {report ? (
            <>Updated {updateFormat.format(query.dataUpdatedAt)}</>
          ) : denied ? (
            "Access unavailable"
          ) : (
            "Updates every 15 seconds"
          )}
        </p>
      </div>
      {!valid && <InlineMessage>Choose a valid business date.</InlineMessage>}
      {valid && query.isPending && (
        <InlineMessage tone="info">Loading sales…</InlineMessage>
      )}
      {valid && query.isError && (
        <div className="sales-error">
          <InlineMessage>
            {denied
              ? "Your access to this shop’s sales reports is unavailable."
              : "We couldn’t refresh sales. Retry to load the saved report."}
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
      {report && (
        <>
          <div className="sales-summary" aria-busy={query.isFetching}>
            <article className="sales-hero" aria-labelledby="sales-total-label">
              <div className="sales-hero-top">
                <h2 id="sales-total-label">
                  {date === today ? "Today’s Sales" : "Gross Sales"}
                </h2>
                <span className="sales-hero-icon">
                  <FiTrendingUp aria-hidden="true" />
                </span>
              </div>
              <p className="sales-hero-date">{prettyDate}</p>
              <strong className="sales-amount">
                {formatCartPrice(report.totalSales)}
              </strong>
              <div className="sales-hero-footer">
                <span>
                  <FiCheck aria-hidden="true" /> Completed & paid
                </span>
                <span>PHP</span>
              </div>
              {report.completedOrders === 0 && (
                <p className="sales-hero-empty">
                  No eligible completed orders for this business day.
                </p>
              )}
            </article>
            <Metric
              id="sales-orders-label"
              title="Number of Orders"
              value={countFormat.format(report.completedOrders)}
              note="Paid & completed orders."
              Icon={FiClipboard}
              number="01"
            />
            <Metric
              id="sales-average-label"
              title="Average Order Value"
              value={formatCartPrice(
                calculateAverageOrderValue(
                  report.totalSales,
                  report.completedOrders,
                ),
              )}
              note={
                report.completedOrders === 0
                  ? "No eligible orders; average is ₱0.00."
                  : "Per completed order."
              }
              Icon={FiBarChart2}
              number="02"
            />
            <Metric
              id="sales-items-label"
              title="Items Sold"
              value={countFormat.format(report.itemsSold)}
              note="Total units sold."
              Icon={FiShoppingBag}
              number="03"
            />
          </div>
          <div className="sales-detail-grid" aria-busy={query.isFetching}>
            <section
              className="sales-payments"
              aria-labelledby="sales-payments-title"
            >
              <header className="sales-panel-heading">
                <div>
                  <p className="sales-kicker">THE PAYMENT MIX</p>
                  <h2 id="sales-payments-title">Payment Breakdown</h2>
                </div>
                <span className="sales-panel-emblem">
                  <FiCreditCard aria-hidden="true" />
                </span>
              </header>
              <div className="sales-payment-visual">
                <div className="sales-payment-ring" aria-hidden="true">
                  <svg viewBox="0 0 160 160">
                    <circle
                      className="sales-ring-track"
                      cx="80"
                      cy="80"
                      r="64"
                      fill="none"
                      strokeWidth="13"
                    />
                    {segments.map((segment, index) => (
                      <circle
                        key={segment.paymentMethod}
                        className={`sales-method-${index}`}
                        cx="80"
                        cy="80"
                        r="64"
                        fill="none"
                        strokeWidth="13"
                        pathLength="100"
                        strokeDasharray={`${segment.share} ${100 - segment.share}`}
                        strokeDashoffset={-segment.offset}
                        transform="rotate(-90 80 80)"
                      />
                    ))}
                  </svg>
                  <div>
                    <strong>
                      {countFormat.format(report.completedOrders)}
                    </strong>
                    <span>orders</span>
                  </div>
                </div>
                <div className="sales-payment-context">
                  <span className="sales-kicker">GROSS SALES</span>
                  <strong>{formatCartPrice(report.totalSales)}</strong>
                  <p>
                    Every payment, accounted for.
                    <br />
                    The ring shows your sales mix.
                  </p>
                </div>
              </div>
              {report.completedOrders === 0 && (
                <p className="sales-empty-note">
                  No eligible payments for this business day.
                </p>
              )}
              <table className="sales-payment-table">
                <caption className="sr-only">
                  Sales and order counts by payment method
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((entry, index) => (
                    <tr key={entry.paymentMethod}>
                      <th scope="row">
                        <span
                          className={`sales-method-dot sales-method-${index}`}
                          aria-hidden="true"
                        />
                        {paymentLabels[entry.paymentMethod]}
                        <span className="sales-method-track" aria-hidden="true">
                          <span
                            className={`sales-method-${index}`}
                            style={
                              { "--share": `${entry.share}%` } as CSSProperties
                            }
                          />
                        </span>
                      </th>
                      <td>{countFormat.format(entry.orders)}</td>
                      <td>{formatCartPrice(entry.totalSales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="sales-panel-footnote">
                Order totals only. Cash change is excluded.
              </p>
            </section>
            <section
              className="sales-recent-orders"
              aria-labelledby="sales-recent-title"
            >
              <header className="sales-panel-heading">
                <div>
                  <p className="sales-kicker">FRESH FROM THE COUNTER</p>
                  <h2 id="sales-recent-title">Recent Orders</h2>
                </div>
                {role === "OWNER" && (
                  <Link
                    className="sales-history-link"
                    to={`${shopPath(shopId)}/orders/completed`}
                  >
                    View completed orders <FiArrowUpRight aria-hidden="true" />
                  </Link>
                )}
              </header>
              <p className="sales-recent-caption">
                Latest 10 completions <span>· Times in Manila</span>
              </p>
              {report.recentOrders.length === 0 ? (
                <div className="sales-feed-empty">
                  <FiClipboard aria-hidden="true" />
                  <h3>A quiet moment.</h3>
                  <p>No completed orders for this business day.</p>
                </div>
              ) : (
                <>
                  <div className="sales-feed-columns" aria-hidden="true">
                    <span>Order</span>
                    <span>Amount</span>
                    <span>Completed</span>
                  </div>
                  <ol
                    className="sales-recent-list"
                    aria-label="Recent completed orders, newest first"
                  >
                    {report.recentOrders.map((order) => (
                      <li key={order.id}>
                        <div className="sales-recent-identity">
                          <span
                            className="sales-receipt-icon"
                            aria-hidden="true"
                          >
                            <FiClipboard />
                          </span>
                          <div>
                            {role === "OWNER" ? (
                              <Link
                                to={`${shopPath(shopId)}/orders/${encodeURIComponent(order.id)}`}
                              >
                                {order.orderNumber}
                                <FiArrowUpRight aria-hidden="true" />
                              </Link>
                            ) : (
                              <strong>{order.orderNumber}</strong>
                            )}
                            <span className="sales-recent-status">
                              <FiCheck aria-hidden="true" />
                              Completed · Paid
                            </span>
                          </div>
                        </div>
                        <strong className="sales-order-amount">
                          {formatCartPrice(order.totalPrice)}
                        </strong>
                        <time dateTime={order.completedAt}>
                          {formatReceiptDateTime(order.completedAt)}
                        </time>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <div className="sales-feed-footer">
                <span>
                  <FiCheck aria-hidden="true" /> Saved, paid & completed
                </span>
                <span>{report.recentOrders.length} shown</span>
              </div>
            </section>
          </div>
        </>
      )}
      <footer className="sales-report-footer">
        <span>
          <FiClock aria-hidden="true" />{" "}
          {denied
            ? "Automatic refresh paused"
            : !valid
              ? "Select a date to refresh"
              : "Refreshes every 15 seconds"}
        </span>
        <details>
          <summary>
            How sales are counted <FiChevronDown aria-hidden="true" />
          </summary>
          <div>
            <p>
              Asia/Manila (UTC+8) · Midnight inclusive to next midnight
              exclusive.
            </p>
            <p>
              Only confirmed, paid and completed orders count, using their
              completion time. Gross sales use saved order totals; refunds and
              expenses are not deducted.
            </p>
            <p>
              Average order value is sales divided by eligible orders, rounded
              to the nearest cent. Items Sold sums item quantities; options and
              add-ons are part of their item.
            </p>
          </div>
        </details>
      </footer>
    </section>
  );
}
