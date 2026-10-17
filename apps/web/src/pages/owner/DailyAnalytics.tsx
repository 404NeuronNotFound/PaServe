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
import { calculateAverageOrderValue, formatCartPrice } from "../../lib/money";

const accessUnavailable = (error: unknown) =>
  isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);

export function DailyAnalytics({
  userId,
  shopId,
  today,
}: {
  userId: string;
  shopId: string;
  today: string;
}) {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const weekly = period === "weekly";
  const monthly = period === "monthly";
  const title = monthly ? "Monthly" : weekly ? "Weekly" : "Daily";
  const [selection, setSelection] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const currentWeek = salesWeeklyRange(today, today)?.weeks[0];
  const currentMonth = salesMonthlyRange(today, today)?.months[0];
  const { start, end } = selection ?? {
    start:
      monthly && currentMonth
        ? currentMonth.monthStart
        : weekly && currentWeek
          ? currentWeek.weekStart
          : today,
    end:
      monthly && currentMonth
        ? currentMonth.monthEnd
        : weekly && currentWeek
          ? currentWeek.weekEnd
          : today,
  };
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
    enabled: valid,
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: (q) => (accessUnavailable(q.state.error) ? false : 15000),
    refetchOnWindowFocus: (q) => !accessUnavailable(q.state.error),
    refetchOnReconnect: (q) => !accessUnavailable(q.state.error),
  });
  const report = valid && query.isSuccess ? query.data : null;
  const denied = accessUnavailable(query.error);
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
        <button
          className="secondary-button"
          disabled={!valid || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh {period} analytics
        </button>
      </div>
      <div className="daily-analytics-controls">
        <div
          className="analytics-period-toggle"
          role="group"
          aria-label="Analytics aggregation"
        >
          <button
            className="secondary-button"
            aria-pressed={period === "daily"}
            onClick={() => setPeriod("daily")}
          >
            Daily
          </button>
          <button
            className="secondary-button"
            aria-pressed={weekly}
            onClick={() => setPeriod("weekly")}
          >
            Weekly
          </button>
          <button
            className="secondary-button"
            aria-pressed={monthly}
            onClick={() => setPeriod("monthly")}
          >
            Monthly
          </button>
        </div>
        <label>
          Start date
          <input
            type="date"
            value={start}
            aria-describedby="daily-range-help"
            aria-invalid={!valid}
            onChange={(e) => setSelection({ start: e.target.value, end })}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={end}
            aria-describedby="daily-range-help"
            aria-invalid={!valid}
            onChange={(e) => setSelection({ start, end: e.target.value })}
          />
        </label>
        <button className="secondary-button" onClick={() => setSelection(null)}>
          {monthly ? "Use this month" : weekly ? "Use this week" : "Use today"}
        </button>
      </div>
      {!valid && (
        <InlineMessage>
          Choose valid start and end dates in order, spanning at most 366 days.
        </InlineMessage>
      )}
      {valid && query.isPending && (
        <InlineMessage tone="info">Loading {period} analytics…</InlineMessage>
      )}
      {valid && query.isError && (
        <InlineMessage>
          {denied
            ? `Your access to this shop’s analytics is unavailable. Automatic refresh is paused; use Refresh ${period} analytics to retry.`
            : `We couldn’t refresh ${period} analytics. Use Refresh ${period} analytics to retry.`}
        </InlineMessage>
      )}
      {report && (
        <>
          <p className="daily-analytics-summary" role="status">
            {start} — {end} · {formatCartPrice(report.totalSales)} gross sales ·{" "}
            {report.completedOrders.toLocaleString("en-PH")} completed orders ·{" "}
            {report.itemsSold.toLocaleString("en-PH")} items sold
          </p>
          {report.completedOrders === 0 && (
            <InlineMessage tone="info">
              No completed sales in this range. All{" "}
              {monthly ? "months" : weekly ? "weeks" : "days"} are shown below.
            </InlineMessage>
          )}
          <div
            className="daily-analytics-table"
            tabIndex={0}
            role="region"
            aria-label={`${title} performance table`}
          >
            <table>
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
                  <th scope="col">Gross sales</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Items sold</th>
                  <th scope="col">Average order value</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((day) => (
                  <tr key={day.key}>
                    <th scope="row">{day.label}</th>
                    <td>{formatCartPrice(day.totalSales)}</td>
                    <td>{day.completedOrders.toLocaleString("en-PH")}</td>
                    <td>{day.itemsSold.toLocaleString("en-PH")}</td>
                    <td>
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
                  <td>{formatCartPrice(report.totalSales)}</td>
                  <td>{report.completedOrders.toLocaleString("en-PH")}</td>
                  <td>{report.itemsSold.toLocaleString("en-PH")}</td>
                  <td>
                    {formatCartPrice(
                      calculateAverageOrderValue(
                        report.totalSales,
                        report.completedOrders,
                      ),
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
