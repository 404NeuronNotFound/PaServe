import { PendingButton } from "../../components/feedback/PendingButton";
import { ReportSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { TopProductMetric } from "@paserve/contracts";
import { getTopProducts } from "../../features/orders/top-products";
import { formatCartPrice } from "../../lib/money";
import { InlineMessage } from "../../components/feedback/InlineMessage";

const denied = (error: unknown) =>
  isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);
export function TopProducts({
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
  const [metric, setMetric] = useState<TopProductMetric>("QUANTITY");
  const query = useQuery({
    queryKey: ["top-products", userId, shopId, startDate, endDate, metric],
    queryFn: ({ signal }) =>
      getTopProducts(shopId, startDate, endDate, metric, signal),
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
      className="daily-analytics top-products"
      aria-labelledby="top-products-title"
    >
      <div className="daily-analytics-heading">
        <div>
          <p className="sales-eyebrow">ANALYTICS / PRODUCTS</p>
          <h2 id="top-products-title">Top Products</h2>
          <p>
            {startDate} – {endDate} · Manila (UTC+8), both dates included.
            Confirmed, paid, completed orders only.
          </p>
        </div>
        <PendingButton
          pending={query.isFetching}
          pendingLabel="Refreshing top products..."
          className="secondary-button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh top products
        </PendingButton>
      </div>
      <div className="daily-analytics-controls">
        <label htmlFor="top-products-metric">
          Rank by
          <select
            id="top-products-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as TopProductMetric)}
          >
            <option value="QUANTITY">Quantity sold</option>
            <option value="REVENUE">Item revenue</option>
          </select>
        </label>
      </div>
      <details className="sales-calculation-notes">
        <summary>How products are ranked</summary>
        <p className="sales-range-help">
          Products are grouped by saved snapshot ID and labelled with their
          latest saved name in this period. Revenue sums saved item line totals,
          including variants and add-ons; current menu prices are not used. It
          may differ from gross sales where historical orders lack matching item
          snapshots.
        </p>
      </details>
      {query.isPending && (
        <ReportSkeleton label="Loading top products…" />
      )}
      {query.isError && (
        <InlineMessage>
          {denied(query.error)
            ? "Top products access is unavailable. Automatic refresh is paused; use Refresh top products to retry."
            : "We couldn’t refresh top products. Use Refresh top products to retry."}
        </InlineMessage>
      )}
      {report &&
        (report.productCount === 0 ? (
          <InlineMessage tone="info">
            No eligible item snapshots in this period.
          </InlineMessage>
        ) : (
          <>
            <p className="daily-analytics-summary">
              Top {report.products.length} of{" "}
              {report.productCount.toLocaleString("en-PH")} products ·{" "}
              {report.totalQuantity.toLocaleString("en-PH")} units ·{" "}
              {formatCartPrice(report.totalRevenue)} item revenue
            </p>
            <div
              className="daily-analytics-table"
              tabIndex={0}
              role="region"
              aria-label="Top products ranking"
            >
              <table>
                <caption>
                  Ranked by{" "}
                  {metric === "QUANTITY"
                    ? "quantity sold, then item revenue"
                    : "item revenue, then quantity sold"}
                  ; remaining ties use saved product ID.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Rank</th>
                    <th scope="col">Quantity sold</th>
                    <th scope="col">Item revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((product, i) => (
                    <tr key={product.productSnapshotId}>
                      <th scope="row">
                        <span className="top-product-name">
                          {product.productName}
                        </span>
                        <span
                          className="top-product-progress"
                          aria-hidden="true"
                        >
                          <span
                            style={{
                              width: (() => {
                                const value =
                                  metric === "QUANTITY"
                                    ? BigInt(product.quantity)
                                    : BigInt(product.revenue.replace(".", ""));
                                const maximum =
                                  metric === "QUANTITY"
                                    ? BigInt(report.products[0].quantity)
                                    : BigInt(
                                        report.products[0].revenue.replace(
                                          ".",
                                          "",
                                        ),
                                      );
                                return maximum === 0n
                                  ? "0%"
                                  : `${Number((value * 10000n) / maximum) / 100}%`;
                              })(),
                            }}
                          />
                        </span>
                        {report.products.filter(
                          (other) => other.productName === product.productName,
                        ).length > 1 && (
                          <small className="top-product-id">
                            Product reference: {product.productSnapshotId}
                          </small>
                        )}
                      </th>
                      <td>
                        <span
                          className={`top-product-rank${i === 0 ? " is-first" : ""}`}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td>{product.quantity.toLocaleString("en-PH")}</td>
                      <td>{formatCartPrice(product.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {report.productCount > 10 && (
                    <tr>
                      <th scope="row">
                        Other products ({report.productCount - 10})
                      </th>
                      <td>—</td>
                      <td>{report.otherQuantity.toLocaleString("en-PH")}</td>
                      <td>{formatCartPrice(report.otherRevenue)}</td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row">All products</th>
                    <td>—</td>
                    <td>{report.totalQuantity.toLocaleString("en-PH")}</td>
                    <td>{formatCartPrice(report.totalRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ))}
    </section>
  );
}
