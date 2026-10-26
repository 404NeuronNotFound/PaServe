import { RefreshButton } from "../../components/feedback/RefreshButton";
import { ListPagination } from "../../components/paserve/ListPagination";
import { listPage } from "../../lib/list-page";
import { Table } from "../../components/ui/table";
import { Button } from "../../components/ui/button";
import { ReportSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  salesDailyRange,
  salesWeeklyRange,
  salesMonthlyRange,
  salesBusinessDate,
  salesBusinessDayBounds,
} from "@paserve/contracts";
import { getDailyAnalytics } from "../../features/orders/daily-analytics";
import { getWeeklyAnalytics } from "../../features/orders/weekly-analytics";
import { getMonthlyAnalytics } from "../../features/orders/monthly-analytics";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ReportEmptyState } from "../../components/feedback/ReportEmptyState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { calculateAverageOrderValue, formatCartPrice } from "../../lib/money";

const accessUnavailable = (error: unknown) =>
  isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);

const dateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
});
const monthFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: "UTC", month: "long", year: "numeric",
});
const formatRange = (start: string, end: string) => dateFormat.formatRange(
  new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`),
);

export function DailyAnalytics({
  userId,
  shopId,
  today,
  startDate: selectedStart,
  endDate: end,
  rangeMode,
  enabled = true,
}: {
  userId: string;
  shopId: string;
  today: string;
  startDate: string;
  endDate: string;
  rangeMode?: "single-day" | "custom";
  enabled?: boolean;
}) {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const presets = rangeMode === "single-day" ||
    (rangeMode === undefined && selectedStart === end);
  const days = period === "monthly" ? 30 : period === "weekly" ? 7 : 1;
  const anchor = salesBusinessDayBounds(end);
  const start = presets && period !== "daily"
    ? anchor
      ? salesBusinessDate(new Date(Date.parse(anchor.from) - (days - 1) * 86_400_000))
      : ""
    : selectedStart;
  const [pagination, setPagination] = useState({ scope: "", page: 1 });
  const scope = `${userId}:${shopId}:${period}:${start}:${end}`;
  const weekly = period === "weekly";
  const monthly = period === "monthly";
  const title = monthly ? "Monthly" : weekly ? "Weekly" : "Daily";
  const valid = !!salesDailyRange(selectedStart, end) && !!(monthly
    ? salesMonthlyRange(start, end)
    : weekly
      ? salesWeeklyRange(start, end)
      : salesDailyRange(start, end));
  const query = useQuery({
    queryKey: [`${period}-analytics`, userId, shopId, start, end],
    queryFn: async ({ signal }) =>
      monthly
        ? await getMonthlyAnalytics(shopId, start, end, signal)
        : weekly
          ? await getWeeklyAnalytics(shopId, start, end, signal)
          : await getDailyAnalytics(shopId, start, end, signal),
    enabled: enabled && valid,
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: (q) => (accessUnavailable(q.state.error) ? false : 15000),
    refetchOnWindowFocus: (q) => !accessUnavailable(q.state.error),
    refetchOnReconnect: (q) => !accessUnavailable(q.state.error),
  });
  const report = enabled && valid && query.isSuccess ? query.data : null;
  const rows =
    report &&
    ("months" in report
      ? report.months.map((month) => ({
          ...month,
          key: month.month,
          label: monthFormat.format(new Date(`${month.month}-01T00:00:00Z`)),
          detail: [month.partial ? formatRange(month.fromDate, month.toDate) : null,
            month.fromDate <= today && month.toDate >= today ? "In progress" : null].filter(Boolean).join(" · "),
        }))
      : "weeks" in report
        ? report.weeks.map((week) => ({
            ...week,
            key: week.weekStart,
            label: formatRange(week.fromDate, week.toDate),
            detail: [week.partial ? "Partial week" : null,
              week.fromDate <= today && week.toDate >= today ? "In progress" : null].filter(Boolean).join(" · "),
          }))
        : report.days.map((day) => ({
            ...day,
            key: day.businessDate,
            label: day.businessDate,
            detail: day.businessDate === today ? "In progress" : "",
          })));
  const history = listPage<NonNullable<typeof rows>[number]>(rows || [], pagination.scope === scope ? pagination.page : 1, 25);
  return (
    <section
      className="daily-analytics"
      aria-labelledby="daily-analytics-title"
    >
      <div className="daily-analytics-heading refresh-heading">
        <div>
          <h2 id="daily-analytics-title">{title} performance</h2>
        </div>
        <RefreshButton label={`Refresh ${period} analytics`}
          pending={query.isFetching}
          pendingLabel="Refreshing analytics..."
          disabled={!enabled || !valid || query.isFetching}
          onClick={() => void query.refetch()}
        />
      </div>
      <div className="daily-analytics-controls">
        <div
          className="analytics-period-toggle"
          role="group"
          aria-label="Sales history period"
        >
          <Button variant="outline" size="inherit" type="button"
            className="secondary-button"
            aria-pressed={period === "daily"}
            onClick={() => setPeriod("daily")}
          >
            Daily
          </Button>
          <Button variant="outline" size="inherit" type="button"
            className="secondary-button"
            aria-pressed={weekly}
            onClick={() => setPeriod("weekly")}
          >
            Weekly
          </Button>
          <Button variant="outline" size="inherit" type="button"
            className="secondary-button"
            aria-pressed={monthly}
            onClick={() => setPeriod("monthly")}
          >
            Monthly
          </Button>
        </div>
      </div>
      {valid && <p className="sales-range-help">
        {presets ? period === "daily" ? "Selected day" : `Last ${days} days` : "Custom range"}
        {" · "}{formatRange(start, end)}
      </p>}
      {!enabled && (
        <InlineMessage tone="info">
          History will update when the selected sales report is available.
        </InlineMessage>
      )}
      {enabled && !valid && (
        <InlineMessage>
          Choose valid start and end dates in order, spanning at most 366 days.
        </InlineMessage>
      )}
      {enabled && valid && query.isPending && (
        <ReportSkeleton label={`Loading ${period} analytics…`} />
      )}
      {enabled && valid && query.isError && (
        <ErrorState error={query.error} resource={`${period} analytics`}
          permissionMessage="Your access to this shop’s analytics is unavailable."
          unavailableMessage="Your access to this shop’s analytics is unavailable."
          pending={query.isFetching} onRetry={() => query.refetch()}
          />
      )}
      {report && (
        <>
          {report.completedOrders === 0 && (
            <ReportEmptyState title="No completed sales in this range."
              description={`All ${monthly ? "months" : weekly ? "weeks" : "days"} are shown below. Choose another reporting period above, or check again after paid orders are completed.`}
              label="sales history" pending={query.isFetching} onRefresh={() => void query.refetch()} />
          )}
          {history.pageCount > 1 && <p className="management-results" role="status">
            Rows {history.first}–{history.last} of {history.total}
          </p>}
          <p className="sales-table-scroll-hint">Swipe or scroll sideways to see all columns.</p>
          <Table containerClassName="daily-analytics-table" scrollLabel={`${title} performance table`}>
              <caption className="sr-only">{title} completed sales for {formatRange(start, end)}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    {monthly
                      ? "Calendar month"
                      : weekly
                        ? "Business week (Mon–Sun)"
                        : "Business date"}
                  </th>
                  <th scope="col" data-numeric>Gross sales</th>
                  <th scope="col" data-numeric>Orders</th>
                  <th scope="col" data-numeric>Items sold</th>
                  <th scope="col" data-numeric>Average order value</th>
                </tr>
              </thead>
              <tbody>
                {history.records.map((day) => (
                  <tr key={day.key}>
                    <th scope="row">{day.label}
                      {day.detail && <small className="analytics-period-detail">{day.detail}</small>}
                    </th>
                    <td data-numeric>{formatCartPrice(day.totalSales)}</td>
                    <td data-numeric>{day.completedOrders.toLocaleString("en-PH")}</td>
                    <td data-numeric>{day.itemsSold.toLocaleString("en-PH")}</td>
                    <td data-numeric>
                      {formatCartPrice(
                        calculateAverageOrderValue(
                          day.totalSales,
                          day.completedOrders,
                        ),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Range total</th>
                  <td data-numeric>{formatCartPrice(report.totalSales)}</td>
                  <td data-numeric>{report.completedOrders.toLocaleString("en-PH")}</td>
                  <td data-numeric>{report.itemsSold.toLocaleString("en-PH")}</td>
                  <td data-numeric>
                    {formatCartPrice(
                      calculateAverageOrderValue(
                        report.totalSales,
                        report.completedOrders,
                      ),
                    )}
                  </td>
                </tr>
              </tfoot>
            </Table>
          {history.pageCount > 1 && <ListPagination label="Sales history pagination" page={history.page} pageCount={history.pageCount}
            onPage={(page) => setPagination({ scope, page })}
            hasNext={history.hasNext} pending={query.isFetching}
            onPrevious={() => setPagination({ scope, page: history.page - 1 })}
            onNext={() => setPagination({ scope, page: history.page + 1 })} />}
        </>
      )}
      <details className="analytics-report-notes">
        <summary>About this report</summary>
        <p>Confirmed, paid and completed orders, grouped by completion date in Manila (UTC+8).
          Weeks run Monday–Sunday; months follow the calendar. Only dates in the displayed
          range count. Today is still in progress.</p>
      </details>
    </section>
  );
}
