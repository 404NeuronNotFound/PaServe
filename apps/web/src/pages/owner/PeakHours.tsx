import { PendingButton } from "../../components/feedback/PendingButton";
import { ReportSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { getPeakHours } from "../../features/orders/peak-hours";
import { formatCartPrice } from "../../lib/money";
import { InlineMessage } from "../../components/feedback/InlineMessage";
const denied = (error: unknown) =>
  isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);
const hourLabel = (hour: number) =>
  `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`;
export function PeakHours({
  userId,
  shopId,
  startDate,
  endDate,
}: {
  userId: string;
  shopId: string;
  startDate: string;
  endDate: string;
}) {
  const query = useQuery({
    queryKey: ["peak-hours", userId, shopId, startDate, endDate],
    queryFn: ({ signal }) => getPeakHours(shopId, startDate, endDate, signal),
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: (q) => (denied(q.state.error) ? false : 15000),
    refetchOnWindowFocus: (q) => !denied(q.state.error),
    refetchOnReconnect: (q) => !denied(q.state.error),
  });
  const report = query.isSuccess ? query.data : null;
  const peak = report
    ? Math.max(...report.hours.map((hour) => hour.completedOrders))
    : 0;
  return (
    <section
      className="daily-analytics peak-hours"
      aria-labelledby="peak-hours-title"
    >
      <div className="daily-analytics-heading">
        <div>
          <p className="sales-eyebrow">ANALYTICS / HOURS</p>
          <h2 id="peak-hours-title">Peak Hours</h2>
          <p className="sales-panel-period">
            {startDate} – {endDate} · Manila (UTC+8), both dates included.
            Confirmed, paid, completed orders only.
          </p>
        </div>
        <PendingButton
          pending={query.isFetching}
          pendingLabel="Refreshing peak hours..."
          className="secondary-button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh peak hours
        </PendingButton>
      </div>
      <details className="sales-calculation-notes">
        <summary>How hourly activity is counted</summary>
        <p className="sales-range-help">
          Completion activity by local hour. Orders count when completed, rather
          than when placed or paid. Counts are pooled across all selected dates;
          24:00 is midnight at the end of the day.
        </p>
      </details>
      {query.isPending && (
        <ReportSkeleton label="Loading peak hours…" chart />
      )}
      {query.isError && (
        <InlineMessage>
          {denied(query.error)
            ? "Peak hours access is unavailable. Automatic refresh is paused; use Refresh peak hours to retry."
            : "We couldn’t refresh peak hours. Use Refresh peak hours to retry."}
        </InlineMessage>
      )}
      {report && (
        <>
          {report.completedOrders === 0 ? (
            <InlineMessage tone="info">
              No eligible completed orders in this period. No busiest hour yet.
            </InlineMessage>
          ) : (
            <p className="daily-analytics-summary" role="status">
              Busiest {report.peakHours.length === 1 ? "hour" : "hours"}:{" "}
              {report.peakHours.map(hourLabel).join(", ")} ·{" "}
              {peak.toLocaleString("en-PH")} orders{" "}
              {report.peakHours.length > 1 ? "each" : ""}
            </p>
          )}
          <p className="sales-range-help">
            {report.completedOrders.toLocaleString("en-PH")} completed orders ·{" "}
            {formatCartPrice(report.totalSales)} gross sales across all hours.
          </p>
          <div
            className="peak-hours-chart-scroll"
            tabIndex={0}
            role="region"
            aria-label="Hourly completion activity chart"
          >
            <div className="peak-hours-chart" aria-hidden="true">
              {report.hours.map((hour) => (
                <div
                  key={hour.hour}
                  className="peak-hour-column"
                  title={`${hourLabel(hour.hour)}: ${hour.completedOrders} orders`}
                >
                  <span
                    className={
                      hour.completedOrders === 0 ? "is-zero" : undefined
                    }
                  >
                    {hour.completedOrders.toLocaleString("en-PH")}
                  </span>
                  <div className="peak-hour-track">
                    <span
                      className={
                        report.peakHours.includes(hour.hour)
                          ? "peak-hour-bar is-peak"
                          : "peak-hour-bar"
                      }
                      style={{
                        height: `${peak > 0 ? (hour.completedOrders / peak) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span>{String(hour.hour).padStart(2, "0")}</span>
                </div>
              ))}
            </div>
          </div>
          <details className="peak-hours-details">
            <summary>View all 24 hourly totals</summary>
            <div
              className="daily-analytics-table"
              tabIndex={0}
              role="region"
              aria-label="Hourly totals table"
            >
              <table>
                <caption>
                  Manila completion hours; each interval includes its start and
                  excludes its end.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Local hour</th>
                    <th scope="col">Completed orders</th>
                    <th scope="col">Gross sales</th>
                  </tr>
                </thead>
                <tbody>
                  {report.hours.map((hour) => (
                    <tr key={hour.hour}>
                      <th scope="row">
                        {hourLabel(hour.hour)}
                        {report.peakHours.includes(hour.hour)
                          ? " (busiest)"
                          : ""}
                      </th>
                      <td>{hour.completedOrders.toLocaleString("en-PH")}</td>
                      <td>{formatCartPrice(hour.totalSales)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">All hours</th>
                    <td>{report.completedOrders.toLocaleString("en-PH")}</td>
                    <td>{formatCartPrice(report.totalSales)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
