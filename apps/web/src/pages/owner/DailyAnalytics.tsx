import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { salesDailyRange } from "@paserve/contracts";
import { getDailyAnalytics } from "../../features/orders/daily-analytics";
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
  const [selection, setSelection] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const { start, end } = selection ?? { start: today, end: today };
  const valid = !!salesDailyRange(start, end);
  const query = useQuery({
    queryKey: ["daily-analytics", userId, shopId, start, end],
    queryFn: ({ signal }) => getDailyAnalytics(shopId, start, end, signal),
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
  return (
    <section
      className="daily-analytics"
      aria-labelledby="daily-analytics-title"
    >
      <div className="daily-analytics-heading">
        <div>
          <p className="sales-eyebrow">ANALYTICS / DAILY</p>
          <h2 id="daily-analytics-title">Daily performance</h2>
          <p id="daily-range-help">
            One row per business day in Manila (UTC+8). Both dates are included;
            maximum 366 days. Sales count confirmed, paid, completed orders by
            completion date.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={!valid || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh daily analytics
        </button>
      </div>
      <div className="daily-analytics-controls">
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
          Use today
        </button>
      </div>
      {!valid && (
        <InlineMessage>
          Choose valid start and end dates in order, spanning at most 366 days.
        </InlineMessage>
      )}
      {valid && query.isPending && (
        <InlineMessage tone="info">Loading daily analytics…</InlineMessage>
      )}
      {valid && query.isError && (
        <InlineMessage>
          {denied
            ? "Your access to this shop’s analytics is unavailable. Automatic refresh is paused; use Refresh daily analytics to retry."
            : "We couldn’t refresh daily analytics. Use Refresh daily analytics to retry."}
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
              No completed sales in this range. All days are shown below.
            </InlineMessage>
          )}
          <div
            className="daily-analytics-table"
            tabIndex={0}
            role="region"
            aria-label="Daily performance table"
          >
            <table>
              <caption>
                Daily aggregation by completion date
                {end >= today
                  ? ". Today is in progress; future dates have no completed sales."
                  : "."}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Business date</th>
                  <th scope="col">Gross sales</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Items sold</th>
                  <th scope="col">Average order value</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((day) => (
                  <tr key={day.businessDate}>
                    <th scope="row">
                      {day.businessDate}
                      {day.businessDate === today ? " (in progress)" : ""}
                    </th>
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
