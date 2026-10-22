import { RefreshButton } from "../../components/feedback/RefreshButton";
import { Table } from "../../components/ui/table";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/paserve/PageHeader";
import { MetricCard as Metric } from "../../components/paserve/MetricCard";
import {
  MetricsSkeleton,
  ReportSkeleton,
  PreparationMetricSkeleton,
} from "../../components/feedback/LoadingSkeleton";
import { DeferredSection } from "../../components/feedback/DeferredSection";
import { lazy, useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  hasShopPermission,
  salesBusinessDate,
  salesBusinessDayBounds,
  salesDailyRange,
  type CurrentUserResponse,
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
  FiShoppingBag,
  FiTrendingUp,
} from "react-icons/fi";
import { shopPath, useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getDailySales } from "../../features/orders/daily-sales";
import { getCustomSales } from "../../features/orders/custom-sales";
import {
  calculatePaymentMix,
  type PaymentMixBasis,
} from "../../features/orders/payment-mix";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ErrorState } from "../../components/feedback/ErrorState";
import { calculateAverageOrderValue, formatCartPrice } from "../../lib/money";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";
import "./sales-dashboard.css";
import "./sales-workspace.css";
import "./sales-minimal.css";
import { DailyAnalytics } from "./DailyAnalytics";
const TopProducts = lazy(() =>
  import("./TopProducts").then((module) => ({ default: module.TopProducts })),
);
const PeakHours = lazy(() =>
  import("./PeakHours").then((module) => ({ default: module.PeakHours })),
);
const AveragePrepTime = lazy(() =>
  import("./AveragePrepTime").then((module) => ({
    default: module.AveragePrepTime,
  })),
);
const SalesTrends = lazy(() =>
  import("./SalesTrends").then((module) => ({ default: module.SalesTrends })),
);

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

export function SalesDashboardPage() {
  const { shopId, role } = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return <SalesWorkspace key={`${userId}:${shopId}:${role}`} userId={userId} />;
}

function SalesWorkspace({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [paymentBasis, setPaymentBasis] = useState<PaymentMixBasis>("SALES");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentExpandedFor, setRecentExpandedFor] = useState<string | null>(
    null,
  );
  const { shopId, role, shop } = useActiveShop();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState({ start: "", end: "" });
  const [customRange, setCustomRange] = useState<{
    start: string;
    end: string;
  } | null>(null);
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
  const reportStartDate = custom ? (customRange?.start ?? "") : date;
  const reportEndDate = custom ? (customRange?.end ?? "") : date;
  const allowed = hasShopPermission(role, "shop.reports.read");
  const validDraft = !!salesDailyRange(customDraft.start, customDraft.end);
  const valid = custom
    ? !!customRange && !!salesDailyRange(customRange.start, customRange.end)
    : !!salesBusinessDayBounds(date);
  const query = useQuery({
    queryKey: custom
      ? ["custom-sales", userId, shopId, customRange?.start, customRange?.end]
      : ["daily-sales", userId, shopId, date],
    queryFn: async ({ signal }) =>
      custom
        ? await getCustomSales(
            shopId,
            customRange!.start,
            customRange!.end,
            signal,
          )
        : await getDailySales(shopId, date, signal),
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
  const reportPeriodKey = `${reportStartDate}:${reportEndDate}`;
  const recentExpanded = recentExpandedFor === reportPeriodKey;
  const visibleRecentOrders =
    report?.recentOrders.slice(0, recentExpanded ? 10 : 3) ?? [];
  const mix = report
    ? calculatePaymentMix(
        report.paymentBreakdown,
        report.totalSales,
        report.completedOrders,
      )
    : [];
  const segments = mix.map((entry, index) => {
    const share =
      (paymentBasis === "SALES"
        ? entry.salesBasisPoints
        : entry.orderBasisPoints) / 100;
    const offset =
      mix
        .slice(0, index)
        .reduce(
          (total, previous) =>
            total +
            (paymentBasis === "SALES"
              ? previous.salesBasisPoints
              : previous.orderBasisPoints),
          0,
        ) / 100;
    return { ...entry, share, offset };
  });
  const mixValues = mix.map((entry) =>
    paymentBasis === "SALES"
      ? BigInt(entry.totalSales.replace(".", ""))
      : BigInt(entry.orders),
  );
  const largestMix = mixValues.reduce(
    (n, value) => (value > n ? value : n),
    0n,
  );
  const leadingMethods = mix.filter(
    (_, index) => largestMix > 0n && mixValues[index] === largestMix,
  );
  const formatDate = (value: string) =>
    dateFormat.format(new Date(`${value}T00:00:00+08:00`));
  const prettyDate = valid
    ? custom
      ? `${formatDate(customRange!.start)} – ${formatDate(customRange!.end)}`
      : formatDate(date)
    : "Choose a date";
  const refreshSales = () => {
    void query.refetch();
    void queryClient.invalidateQueries({
      queryKey: ["top-products", userId, shopId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["peak-hours", userId, shopId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["average-prep-time", userId, shopId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["sales-trends", userId, shopId],
    });
    for (const period of ["daily", "weekly", "monthly"]) {
      void queryClient.invalidateQueries({
        queryKey: [`${period}-analytics`, userId, shopId],
      });
    }
  };

  return (
    <section
      className="sales-dashboard sales-minimal"
      aria-labelledby="sales-title"
    >
      <PageHeader className="sales-header">
        <div>
          <h1 id="sales-title">Sales dashboard</h1>
          <p className="sales-intro">{shop.name} · Completed sales · PHP</p>
        </div>
        <RefreshButton
          label="Refresh sales"
          disabled={!valid || query.isFetching}
          onClick={refreshSales}
          pending={query.isFetching}
        />
      </PageHeader>
      <div className="sales-period-panel" id="sales-overview">
        <div
          className="analytics-period-toggle sales-report-mode"
          role="group"
          aria-label="Sales report period"
        >
          <Button
            variant="outline"
            size="inherit"
            type="submit"
            className="secondary-button"
            aria-pressed={!custom}
            onClick={() => setCustom(false)}
          >
            Single day
          </Button>
          <Button
            variant="outline"
            size="inherit"
            type="submit"
            className="secondary-button"
            aria-pressed={custom}
            onClick={() => {
              setCustomDraft(customRange ?? { start: date, end: date });
              setCustom(true);
            }}
          >
            Custom Date
          </Button>
        </div>
        <div className="sales-toolbar">
          {custom ? (
            <form
              className="sales-custom-range"
              aria-label="Custom sales dates"
              onSubmit={(event) => {
                event.preventDefault();
                if (validDraft) setCustomRange({ ...customDraft });
              }}
            >
              <label htmlFor="custom-sales-start">
                Start date
                <Input
                  id="custom-sales-start"
                  type="date"
                  value={customDraft.start}
                  aria-describedby="custom-sales-help"
                  aria-invalid={!validDraft}
                  onChange={(e) =>
                    setCustomDraft({ ...customDraft, start: e.target.value })
                  }
                />
              </label>
              <label htmlFor="custom-sales-end">
                End date
                <Input
                  id="custom-sales-end"
                  type="date"
                  value={customDraft.end}
                  aria-describedby="custom-sales-help"
                  aria-invalid={!validDraft}
                  onChange={(e) =>
                    setCustomDraft({ ...customDraft, end: e.target.value })
                  }
                />
              </label>
              <Button
                variant="outline"
                size="inherit"
                className="secondary-button"
                type="submit"
                disabled={!validDraft}
              >
                Apply date range
              </Button>
            </form>
          ) : (
            <div className="sales-period">
              <FiCalendar aria-hidden="true" />
              <label htmlFor="sales-date">
                Business date
                <Input
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
              <Button
                variant="ghost"
                size="inherit"
                type="submit"
                className="sales-today"
                aria-pressed={date === today}
                onClick={() => {
                  setToday(salesBusinessDate());
                  setSelectedDate(null);
                }}
              >
                Today
              </Button>
            </div>
          )}
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
        {custom && (
          <p id="custom-sales-help" className="sales-range-help">
            Both dates are included in Manila (UTC+8); maximum 366 days. Apply
            the range to every card, chart and history view.
          </p>
        )}
        {custom && !validDraft && (
          <InlineMessage>
            Choose valid start/end dates in order, spanning at most 366 days.
          </InlineMessage>
        )}
        {custom && customRange && (
          <p className="sales-range-help" role="status">
            Applied to all metrics: {customRange.start} – {customRange.end}.
            {customDraft.start !== customRange.start ||
            customDraft.end !== customRange.end
              ? " Date edits are not applied yet."
              : ""}
          </p>
        )}
      </div>
      {!valid &&
        (custom ? (
          <InlineMessage tone="info">
            Choose dates and select Apply date range to load all metrics.
          </InlineMessage>
        ) : (
          <InlineMessage>Choose a valid business date.</InlineMessage>
        ))}
      {valid && query.isPending && <MetricsSkeleton />}
      {valid && query.isError && (
        <ErrorState
          error={query.error}
          resource="sales reports"
          permissionMessage="Your access to this shop’s sales reports is unavailable."
          unavailableMessage="Your access to this shop’s sales reports is unavailable."
          pending={query.isFetching}
          onRetry={refreshSales}
        />
      )}
      {report && (
        <section
          className="sales-overview-metrics"
          aria-labelledby="sales-overview-title"
        >
          <header className="sales-overview-heading">
            <div>
              <h2 id="sales-overview-title">Business overview</h2>
              <p>{prettyDate} · Completed and paid orders · PHP</p>
            </div>
          </header>
          <div className="sales-summary" aria-busy={query.isFetching}>
            <article className="sales-hero" aria-labelledby="sales-total-label">
              <div className="sales-hero-top">
                <h2 id="sales-total-label">
                  {!custom && date === today ? "Today’s Sales" : "Gross Sales"}
                </h2>
                <span className="sales-hero-icon">
                  <FiTrendingUp aria-hidden="true" />
                </span>
              </div>
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
                  No eligible completed orders for this{" "}
                  {custom ? "date range" : "business day"}.
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
        </section>
      )}
      <div
        className="sales-chart-grid"
        role="group"
        aria-label="Sales charts and activity"
      >
        {valid && !denied && (
          <div id="sales-trends-section" className="sales-section-anchor">
            <DeferredSection
              label="sales trends"
              placeholder={
                <section className="daily-analytics">
                  <h2>Sales Trends</h2>
                  <ReportSkeleton label="Loading sales trends…" chart />
                </section>
              }
            >
              <SalesTrends
                compact
                userId={userId}
                shopId={shopId}
                startDate={reportStartDate}
                endDate={reportEndDate}
              />
            </DeferredSection>
          </div>
        )}
        {report && (
          <>
            <div
              className="sales-payment-detail sales-section-anchor"
              id="sales-payment-section"
              aria-busy={query.isFetching}
            >
              <section
                className="sales-payments"
                aria-labelledby="sales-payments-title"
              >
                <header className="sales-panel-heading">
                  <div>
                    <h2 id="sales-payments-title">Payment Breakdown</h2>
                  </div>
                  <span className="sales-panel-emblem">
                    <FiCreditCard aria-hidden="true" />
                  </span>
                </header>

                <div
                  className="analytics-period-toggle sales-payment-basis"
                  role="group"
                  aria-label="Payment mix basis"
                >
                  <Button
                    variant="outline"
                    size="inherit"
                    type="submit"
                    className="secondary-button"
                    aria-pressed={paymentBasis === "SALES"}
                    onClick={() => setPaymentBasis("SALES")}
                  >
                    Sales share
                  </Button>
                  <Button
                    variant="outline"
                    size="inherit"
                    type="submit"
                    className="secondary-button"
                    aria-pressed={paymentBasis === "ORDERS"}
                    onClick={() => setPaymentBasis("ORDERS")}
                  >
                    Order share
                  </Button>
                </div>
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
                      <span>completed orders</span>
                    </div>
                  </div>
                  <div className="sales-payment-context">
                    <span className="sales-kicker">GROSS SALES</span>
                    <strong>{formatCartPrice(report.totalSales)}</strong>
                    <p>
                      {countFormat.format(report.completedOrders)} eligible
                      orders.
                      <br />
                      The ring and bars show{" "}
                      {paymentBasis === "SALES" ? "sales share" : "order share"}
                      .
                    </p>
                  </div>
                </div>
                {leadingMethods.length > 0 && (
                  <p className="sales-payment-insight" role="status">
                    {paymentBasis === "SALES"
                      ? "Largest sales total"
                      : "Most used"}
                    :{" "}
                    {leadingMethods
                      .map((entry) => paymentLabels[entry.paymentMethod])
                      .join(", ")}{" "}
                    ·{" "}
                    {paymentBasis === "SALES"
                      ? formatCartPrice(leadingMethods[0].totalSales)
                      : `${countFormat.format(leadingMethods[0].orders)} ${leadingMethods[0].orders === 1 ? "order" : "orders"}`}
                    {leadingMethods.length > 1 ? " each" : ""}.
                  </p>
                )}
                {report.completedOrders > 0 &&
                  report.totalSales === "0.00" &&
                  paymentBasis === "SALES" && (
                    <InlineMessage tone="info">
                      Sales total is ₱0.00, so sales shares are zero. Switch to
                      Order share to see the payment mix by order count.
                    </InlineMessage>
                  )}
                {report.completedOrders === 0 && (
                  <p className="sales-empty-note">
                    No eligible payments for this{" "}
                    {custom ? "date range" : "business day"}.
                  </p>
                )}
                <ul
                  className="sales-payment-legend"
                  aria-label="Payment method shares"
                >
                  {segments.map((entry, index) => (
                    <li key={entry.paymentMethod}>
                      <span>
                        <i
                          className={`sales-method-dot sales-method-${index}`}
                          aria-hidden="true"
                        />
                        {paymentLabels[entry.paymentMethod]}
                      </span>
                      <strong>
                        {paymentBasis === "SALES"
                          ? entry.salesShare
                          : entry.orderShare}
                      </strong>
                      <small>
                        {paymentBasis === "SALES"
                          ? formatCartPrice(entry.totalSales)
                          : `${countFormat.format(entry.orders)} orders`}
                      </small>
                    </li>
                  ))}
                </ul>
                <details className="sales-data-details">
                  <summary>View payment details</summary>
                  <Table
                    containerClassName="sales-payment-table-scroll"
                    scrollLabel="Payment method shares table"
                    className="sales-payment-table"
                  >
                    <caption className="sr-only">
                      Sales and order counts by payment method
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Method</th>
                        <th scope="col">Orders</th>
                        <th
                          scope="col"
                          className={
                            paymentBasis === "ORDERS"
                              ? "is-selected"
                              : undefined
                          }
                        >
                          Order share
                        </th>
                        <th scope="col">Sales</th>
                        <th
                          scope="col"
                          className={
                            paymentBasis === "SALES" ? "is-selected" : undefined
                          }
                        >
                          Sales share
                        </th>
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
                            <span
                              className="sales-method-track"
                              aria-hidden="true"
                            >
                              <span
                                className={`sales-method-${index}`}
                                style={
                                  {
                                    "--share": `${entry.share}%`,
                                  } as CSSProperties
                                }
                              />
                            </span>
                          </th>
                          <td>{countFormat.format(entry.orders)}</td>
                          <td
                            className={
                              paymentBasis === "ORDERS"
                                ? "is-selected"
                                : undefined
                            }
                          >
                            {entry.orderShare}
                          </td>
                          <td>{formatCartPrice(entry.totalSales)}</td>
                          <td
                            className={
                              paymentBasis === "SALES"
                                ? "is-selected"
                                : undefined
                            }
                          >
                            {entry.salesShare}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">All methods</th>
                        <td>{countFormat.format(report.completedOrders)}</td>
                        <td>
                          {report.completedOrders > 0 ? "100.00%" : "0.00%"}
                        </td>
                        <td>{formatCartPrice(report.totalSales)}</td>
                        <td>
                          {report.totalSales === "0.00" ? "0.00%" : "100.00%"}
                        </td>
                      </tr>
                    </tfoot>
                  </Table>
                  <p className="sales-panel-footnote">
                    Confirmed, paid, completed order totals only; cash
                    tender/change are excluded. Zero-value paid orders count
                    toward order share. Shares are rounded to 0.01% and adjusted
                    to total 100% when the basis is nonzero.
                  </p>
                </details>
              </section>
            </div>
          </>
        )}
        {valid && !denied && (
          <div className="sales-section-anchor" id="sales-products-section">
            <DeferredSection
              label="top products"
              placeholder={
                <section className="daily-analytics">
                  <h2>Top Products</h2>
                  <ReportSkeleton label="Loading top products…" />
                </section>
              }
            >
              <TopProducts
                compact
                userId={userId}
                shopId={shopId}
                startDate={reportStartDate}
                endDate={reportEndDate}
              />
            </DeferredSection>
          </div>
        )}
        {valid && !denied && (
          <div
            className="sales-operations-grid sales-section-anchor"
            id="sales-operations-section"
          >
            <div className="sales-hour-card">
              <DeferredSection
                label="peak hours"
                placeholder={
                  <section className="daily-analytics">
                    <h2>Peak Hours</h2>
                    <ReportSkeleton label="Loading peak hours…" chart />
                  </section>
                }
              >
                <PeakHours
                  compact
                  userId={userId}
                  shopId={shopId}
                  startDate={reportStartDate}
                  endDate={reportEndDate}
                />
              </DeferredSection>
            </div>
            <div className="sales-prep-card">
              <DeferredSection
                label="average preparation time"
                placeholder={
                  <section className="daily-analytics">
                    <h2>Average Prep Time</h2>
                    <PreparationMetricSkeleton />
                  </section>
                }
              >
                <AveragePrepTime
                  compact
                  userId={userId}
                  shopId={shopId}
                  startDate={reportStartDate}
                  endDate={reportEndDate}
                />
              </DeferredSection>
            </div>
          </div>
        )}
        {report && (
          <section
            className="sales-recent-orders"
            aria-labelledby="sales-recent-title"
          >
            <header className="sales-panel-heading">
              <div>
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
                <p>
                  No completed orders for this{" "}
                  {custom ? "date range" : "business day"}.
                </p>
                <Button
                  variant="outline"
                  size="inherit"
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const control = document.getElementById(
                      custom ? "custom-sales-start" : "sales-date",
                    );
                    control?.scrollIntoView?.({ block: "center" });
                    control?.focus();
                  }}
                >
                  Choose another reporting period
                </Button>
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
                  id="sales-recent-list"
                  aria-label="Recent completed orders, newest first"
                >
                  {visibleRecentOrders.map((order) => (
                    <li key={order.id}>
                      <div className="sales-recent-identity">
                        <span className="sales-receipt-icon" aria-hidden="true">
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
              <span>
                {visibleRecentOrders.length} of {report.recentOrders.length}{" "}
                recent orders shown
              </span>
            </div>
            {report.recentOrders.length > 3 && (
              <Button
                variant="outline"
                aria-expanded={recentExpanded}
                aria-controls="sales-recent-list"
                onClick={() =>
                  setRecentExpandedFor(recentExpanded ? null : reportPeriodKey)
                }
              >
                {recentExpanded
                  ? "Show fewer recent orders"
                  : `Show all ${report.recentOrders.length} recent orders`}
              </Button>
            )}
          </section>
        )}
      </div>
      <details
        className="sales-history sales-section-anchor"
        id="sales-history-section"
        open={historyOpen}
        onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="sales-history-icon">
            <FiBarChart2 aria-hidden="true" />
          </span>
          <span>
            <strong>Daily, weekly & monthly history</strong>
            <span>
              Explore the selected reporting period by day, week or month.
            </span>
          </span>
          <FiChevronDown aria-hidden="true" />
        </summary>
        {historyOpen && (
          <DailyAnalytics
            userId={userId}
            shopId={shopId}
            today={today}
            startDate={reportStartDate}
            endDate={reportEndDate}
            enabled={valid && !denied}
          />
        )}
      </details>
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
              Asia/Manila (UTC+8) ·{" "}
              {custom
                ? "Start date midnight inclusive to midnight after the end date"
                : "Midnight inclusive to next midnight"}
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
