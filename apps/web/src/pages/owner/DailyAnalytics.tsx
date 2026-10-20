import { ListPagination } from "../../components/paserve/ListPagination";
import { listPage } from "../../lib/list-page";
import { Table } from "../../components/ui/table";
import { Button } from "../../components/ui/button";
import { PendingButton } from "../../components/feedback/PendingButton";
import { ReportSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  salesDailyRange,
  salesWeeklyRange,
  salesMonthlyRange,
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

export function DailyAnalytics({
  userId,
  shopId,
  today,
  startDate: start,
  endDate: end,
  enabled = true,
}: {
  userId: string;
  shopId: string;
  today: string;
  startDate: string;
  endDate: string;
  enabled?: boolean;
}) {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [pagination, setPagination] = useState({ scope: "", page: 1 });
  const scope = `${userId}:${shopId}:${period}:${start}:${end}`;
  const weekly = period === "weekly";
  const monthly = period === "monthly";
  const title = monthly ? "Monthly" : weekly ? "Weekly" : "Daily";
  const valid = !!(monthly
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
          label: `${month.month} (${month.monthStart} – ${month.monthEnd})${month.partial ? ` (partial: ${month.fromDate} – ${month.toDate})` : ""}${month.fromDate <= today && month.toDate >= today ? " (in progress)" : ""}`,
        }))
      : "weeks" in report
        ? report.weeks.map((week) => ({
            ...week,
            key: week.weekStart,
            label: `${week.weekStart} – ${week.weekEnd}${week.partial ? ` (partial: ${week.fromDate} – ${week.toDate})` : ""}${week.fromDate <= today && week.toDate >= today ? " (in progress)" : ""}`,
          }))
        : report.days.map((day) => ({
            ...day,
            key: day.businessDate,
            label: `${day.businessDate}${day.businessDate === today ? " (in progress)" : ""}`,
          })));
  const history = listPage<NonNullable<typeof rows>[number]>(rows || [], pagination.scope === scope ? pagination.page : 1, 25);
  return (
    <section
      className="daily-analytics"
      aria-labelledby="daily-analytics-title"
    >
      <div className="daily-analytics-heading">
        <div>
          <p className="sales-eyebrow">ANALYTICS / {title.toUpperCase()}</p>
          <h2 id="daily-analytics-title">{title} performance</h2>
          <p id="daily-range-help">
            {monthly
              ? "Calendar months in Manila (UTC+8), from the first day through the last day. Partial months count only selected dates."
              : weekly
                ? "Monday–Sunday weeks in Manila (UTC+8). Partial weeks count only selected dates."
                : "One row per business day in Manila (UTC+8)."}{" "}
            Both dates are included; maximum 366 days. Sales count confirmed,
            paid, completed orders by completion date.
          </p>
        </div>
        <PendingButton
          pending={query.isFetching}
          pendingLabel="Refreshing analytics..."
          className="secondary-button"
          disabled={!enabled || !valid || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh {period} analytics
        </PendingButton>
      </div>
      <div className="daily-analytics-controls">
        <div
          className="analytics-period-toggle"
          role="group"
          aria-label="Analytics aggregation"
        >
          <Button variant="outline" size="inherit" type="submit"
            className="secondary-button"
            aria-pressed={period === "daily"}
            onClick={() => setPeriod("daily")}
          >
            Daily
          </Button>
          <Button variant="outline" size="inherit" type="submit"
            className="secondary-button"
            aria-pressed={weekly}
            onClick={() => setPeriod("weekly")}
          >
            Weekly
          </Button>
          <Button variant="outline" size="inherit" type="submit"
            className="secondary-button"
            aria-pressed={monthly}
            onClick={() => setPeriod("monthly")}
          >
            Monthly
          </Button>
        </div>
      </div>
      <p className="sales-range-help">
        {start && end ? `${start} – ${end}. ` : ""}Uses the reporting period
        selected above. Grouping does not change the dates.
      </p>
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
          pending={query.isFetching} onRetry={() => query.refetch()} />
      )}
      {report && (
        <>
          <p className="daily-analytics-summary" role="status">
            {start} — {end} · {formatCartPrice(report.totalSales)} gross sales ·{" "}
            {report.completedOrders.toLocaleString("en-PH")} completed orders ·{" "}
            {report.itemsSold.toLocaleString("en-PH")} items sold
          </p>
          {report.completedOrders === 0 && (
            <ReportEmptyState title="No completed sales in this range."
              description={`All ${monthly ? "months" : weekly ? "weeks" : "days"} are shown below. Choose another reporting period above, or check again after paid orders are completed.`}
              label="sales history" pending={query.isFetching} onRefresh={() => void query.refetch()} />
          )}
          <p className="management-results" role="status">
            Rows {history.first}-{history.last} of {history.total}. Range totals include every row in the selected period.
          </p>
          <Table containerClassName="daily-analytics-table" scrollLabel={`${title} performance table`}>
              <caption>
                {title} aggregation by completion date
                {monthly
                  ? "; calendar months"
                  : weekly
                    ? "; weeks run Monday–Sunday"
                    : ""}
                {end >= today
                  ? ". Today is in progress; future dates have no completed sales."
                  : "."}
              </caption>
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
                    <th scope="row">{day.label}</th>
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
          <ListPagination label="Sales history pagination" page={history.page} pageCount={history.pageCount}
            hasNext={history.hasNext} pending={query.isFetching}
            onPrevious={() => setPagination({ scope, page: history.page - 1 })}
            onNext={() => setPagination({ scope, page: history.page + 1 })} />
        </>
      )}
    </section>
  );
}
