import { ReportSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { salesBusinessDate, salesTrendRanges } from "@paserve/contracts";
import {
  getSalesTrends,
  trendPercentage,
} from "../../features/orders/sales-trends";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { formatCartPrice } from "../../lib/money";
import { SalesTrendChart } from "./SalesTrendChart";

const denied = (error: unknown) =>
  isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);
const cents = (value: string) => BigInt(value.replace(".", ""));
const change = (value: bigint) =>
  value === 0n ? "No change" : value > 0n ? "Increase" : "Decrease";
const moneyChange = (value: bigint) => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : value > 0n ? "+" : ""}${formatCartPrice(`${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`)}`;
};
export function SalesTrends({
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
  const valid = !!salesTrendRanges(startDate, endDate);
  const query = useQuery({
    queryKey: ["sales-trends", userId, shopId, startDate, endDate],
    queryFn: ({ signal }) => getSalesTrends(shopId, startDate, endDate, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: (q) => (denied(q.state.error) ? false : 15000),
    refetchOnWindowFocus: (q) => !denied(q.state.error),
    refetchOnReconnect: (q) => !denied(q.state.error),
  });
  const report = valid && query.isSuccess ? query.data : null;
  const current = report?.current,
    previous = report?.previous;
  const maximum = report
    ? [...report.current.days, ...report.previous.days].reduce(
        (max, day) =>
          cents(day.totalSales) > max ? cents(day.totalSales) : max,
        0n,
      )
    : 0n;
  const width = (value: string) =>
    maximum === 0n
      ? "0%"
      : `${Number((cents(value) * 10000n) / maximum) / 100}%`;
  return (
    <section
      className="daily-analytics sales-trends"
      aria-labelledby="sales-trends-title"
    >
      <div className="daily-analytics-heading">
        <div>
          <p className="sales-eyebrow">ANALYTICS / COMPARISON</p>
          <h2 id="sales-trends-title">Sales Trends</h2>
          <p>
            {startDate} – {endDate} · Manila (UTC+8). Compared with the
            immediately preceding equal-length period.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={!valid || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh sales trends
        </button>
      </div>
      {!valid && (
        <InlineMessage>
          These dates have no supported preceding comparison period. Choose
          later dates.
        </InlineMessage>
      )}
      {valid && query.isPending && (
        <ReportSkeleton label="Loading sales trends…" chart />
      )}
      {valid && query.isError && (
        <InlineMessage>
          {denied(query.error)
            ? "Sales trends access is unavailable. Automatic refresh is paused; use Refresh sales trends to retry."
            : "We couldn’t refresh sales trends. Use Refresh sales trends to retry."}
        </InlineMessage>
      )}
      {current && previous && (
        <>
          <p className="sales-range-help sales-comparison-periods">
            Selected: {current.startDate} – {current.endDate}. Previous:{" "}
            {previous.startDate} – {previous.endDate}. Both periods contain{" "}
            {current.days.length} day(s).
          </p>
          {endDate >= salesBusinessDate() && (
            <InlineMessage tone="info">
              The selected period includes today or future dates and is not
              final. This compares full calendar ranges, not matching elapsed
              time.
            </InlineMessage>
          )}
          {current.completedOrders === 0 && previous.completedOrders === 0 && (
            <InlineMessage tone="info">
              No completed sales in either period.
            </InlineMessage>
          )}
          <dl className="sales-trend-summary">
            <div
              data-direction={change(
                cents(current.totalSales) - cents(previous.totalSales),
              ).toLowerCase()}
            >
              <dt>Gross sales</dt>
              <dd>
                {formatCartPrice(current.totalSales)}
                <p>Previous: {formatCartPrice(previous.totalSales)}</p>
                <p>
                  {change(
                    cents(current.totalSales) - cents(previous.totalSales),
                  )}
                  :{" "}
                  {moneyChange(
                    cents(current.totalSales) - cents(previous.totalSales),
                  )}{" "}
                  ·{" "}
                  {trendPercentage(
                    cents(current.totalSales),
                    cents(previous.totalSales),
                  ) ?? "No prior sales baseline"}
                </p>
              </dd>
            </div>
            <div
              data-direction={change(
                BigInt(current.completedOrders) -
                  BigInt(previous.completedOrders),
              ).toLowerCase()}
            >
              <dt>Completed orders</dt>
              <dd>
                {current.completedOrders.toLocaleString("en-PH")}
                <p>
                  Previous: {previous.completedOrders.toLocaleString("en-PH")}
                </p>
                <p>
                  {change(
                    BigInt(current.completedOrders) -
                      BigInt(previous.completedOrders),
                  )}
                  :{" "}
                  {current.completedOrders > previous.completedOrders
                    ? "+"
                    : ""}
                  {(
                    BigInt(current.completedOrders) -
                    BigInt(previous.completedOrders)
                  ).toLocaleString("en-PH")}{" "}
                  ·{" "}
                  {trendPercentage(
                    BigInt(current.completedOrders),
                    BigInt(previous.completedOrders),
                  ) ?? "No prior order baseline"}
                </p>
              </dd>
            </div>
          </dl>
          <SalesTrendChart
            key={`${current.startDate}:${current.endDate}`}
            current={current}
            previous={previous}
          />
          <details className="sales-calculation-notes">
            <summary>About this comparison</summary>
            <p className="sales-range-help">
              Confirmed, paid, completed orders by completion date. Daily
              positions are paired in order; weekdays may differ. Percent change
              uses the previous period as its baseline.
            </p>
          </details>
          <details className="sales-comparison-details">
            <summary>View daily comparison data</summary>
            <div
              className="daily-analytics-table"
              tabIndex={0}
              role="region"
              aria-label="Sales trends daily comparison"
            >
              <table>
                <caption>
                  Daily gross sales on a shared scale. Solid bars: selected
                  period; outlined bars: previous period. Zero-sale days are
                  included.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Selected date</th>
                    <th scope="col">Sales / orders</th>
                    <th scope="col">Previous date</th>
                    <th scope="col">Sales / orders</th>
                  </tr>
                </thead>
                <tbody>
                  {current.days.map((day, i) => {
                    const prior = previous.days[i];
                    return (
                      <tr key={day.businessDate}>
                        <th scope="row">{day.businessDate}</th>
                        <td>
                          <span className="sales-trend-bar" aria-hidden="true">
                            <span style={{ width: width(day.totalSales) }} />
                          </span>
                          {formatCartPrice(day.totalSales)} /{" "}
                          {day.completedOrders.toLocaleString("en-PH")}
                        </td>
                        <td>{prior.businessDate}</td>
                        <td>
                          <span
                            className="sales-trend-bar previous"
                            aria-hidden="true"
                          >
                            <span style={{ width: width(prior.totalSales) }} />
                          </span>
                          {formatCartPrice(prior.totalSales)} /{" "}
                          {prior.completedOrders.toLocaleString("en-PH")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
