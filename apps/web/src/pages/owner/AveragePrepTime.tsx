import { PendingButton } from "../../components/feedback/PendingButton";
import { useQuery } from "@tanstack/react-query";
import { PreparationMetricSkeleton } from "../../components/feedback/LoadingSkeleton";
import { isAxiosError } from "axios";
import {
  getAveragePrepTime,
  formatPreparationDuration,
} from "../../features/orders/average-prep-time";
import { InlineMessage } from "../../components/feedback/InlineMessage";
const denied = (error: unknown) =>
  isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);
export function AveragePrepTime({
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
    queryKey: ["average-prep-time", userId, shopId, startDate, endDate],
    queryFn: ({ signal }) =>
      getAveragePrepTime(shopId, startDate, endDate, signal),
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: (q) => (denied(q.state.error) ? false : 15000),
    refetchOnWindowFocus: (q) => !denied(q.state.error),
    refetchOnReconnect: (q) => !denied(q.state.error),
  });
  const report = query.isSuccess ? query.data : null;
  return (
    <section
      className="daily-analytics average-prep-time"
      aria-labelledby="average-prep-time-title"
    >
      <div className="daily-analytics-heading">
        <div>
          <p className="sales-eyebrow">ANALYTICS / PREPARATION</p>
          <h2 id="average-prep-time-title">Average Prep Time</h2>
          <p className="sales-panel-period">
            {startDate} – {endDate} · Manila (UTC+8), both dates included.
            Confirmed, paid, completed orders only.
          </p>
        </div>
        <PendingButton
          pending={query.isFetching}
          pendingLabel="Refreshing preparation time..."
          className="secondary-button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh prep time
        </PendingButton>
      </div>
      <p className="sales-range-help sales-prep-pair">
        Preparing → Ready. Only complete, valid timestamp pairs contribute to
        your average.
      </p>
      {query.isPending && (
        <PreparationMetricSkeleton />
      )}
      {query.isError && (
        <InlineMessage>
          {denied(query.error)
            ? "Preparation report access is unavailable. Automatic refresh is paused; use Refresh prep time to retry."
            : "We couldn’t refresh average preparation time. Use Refresh prep time to retry."}
        </InlineMessage>
      )}
      {report && (
        <>
          {report.averageDurationMs === null ? (
            <InlineMessage tone="info">
              No preparation data. No eligible orders have a valid Preparing →
              Ready timestamp pair in this period.
            </InlineMessage>
          ) : (
            <p className="prep-time-average" role="status">
              {formatPreparationDuration(report.averageDurationMs)}
              <span>
                Average from {report.measuredOrders.toLocaleString("en-PH")}{" "}
                measured {report.measuredOrders === 1 ? "order" : "orders"}
              </span>
            </p>
          )}
          <dl className="prep-time-coverage">
            <div>
              <dt>Eligible orders</dt>
              <dd>{report.eligibleOrders.toLocaleString("en-PH")}</dd>
            </div>
            <div>
              <dt>Measured orders</dt>
              <dd>{report.measuredOrders.toLocaleString("en-PH")}</dd>
            </div>
            <div>
              <dt>Excluded orders</dt>
              <dd>{report.excludedOrders.toLocaleString("en-PH")}</dd>
            </div>
          </dl>
          {report.excludedOrders > 0 && (
            <p className="sales-range-help">
              Excluded: {report.missingTimestamps.toLocaleString("en-PH")} with
              missing timestamps;{" "}
              {report.invalidTimestamps.toLocaleString("en-PH")} with invalid
              timestamp order.
            </p>
          )}
          <details className="prep-time-definition">
            <summary>How preparation time is measured</summary>
            <p className="sales-range-help">
              Ready time minus Preparing start, averaged once per measured order
              and rounded to the nearest millisecond. Ready must be at or after
              Preparing start and no later than completion. Missing or invalid
              pairs are excluded from the average. A valid zero-duration pair
              counts; an empty sample has no average. Queue wait and time from
              Ready to completion are excluded. Orders are selected by
              completion date; the full preparation duration counts even when it
              starts before the selected period.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
