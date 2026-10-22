import { RefreshButton } from "../../components/feedback/RefreshButton";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { TopProductMetric } from "@paserve/contracts";
import { getTopProducts } from "../../features/orders/top-products";
import { formatCartPrice } from "../../lib/money";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ErrorState } from "../../components/feedback/ErrorState";
import { ReportEmptyState } from "../../components/feedback/ReportEmptyState";

const denied = (error: unknown) =>
  isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);
export function TopProducts({
  userId,
  shopId,
  startDate,
  endDate,
  compact = false,
}: {
  userId: string;
  shopId: string;
  startDate: string;
  endDate: string;
  compact?: boolean;
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
          {!compact && <p className="sales-eyebrow">ANALYTICS / PRODUCTS</p>}
          <h2 id="top-products-title">Top Products</h2>
          {!compact && (
            <p>
              {startDate} – {endDate} · Manila (UTC+8), both dates included.
              Confirmed, paid, completed orders only.
            </p>
          )}
        </div>
        <RefreshButton
          label="Refresh top products"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          pending={query.isFetching}
        />
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
      {query.isPending && (
        <InlineMessage tone="info">Loading top products…</InlineMessage>
      )}
      {query.isError && (
        <ErrorState
          error={query.error}
          resource="top products"
          permissionMessage="Top products access is unavailable. Automatic refresh is paused; use Refresh top products to check access again."
          pending={query.isFetching}
          onRetry={() => query.refetch()}
        />
      )}
      {report &&
        (report.productCount === 0 ? (
          <ReportEmptyState
            title="No product sales to rank."
            description="No eligible item snapshots in this period."
            label="product sales"
            pending={query.isFetching}
            onRefresh={() => void query.refetch()}
          />
        ) : (
          <>
            <p className="daily-analytics-summary">
              Top {report.products.length} of{" "}
              {report.productCount.toLocaleString("en-PH")} products ·{" "}
              {report.totalQuantity.toLocaleString("en-PH")} units ·{" "}
              {formatCartPrice(report.totalRevenue)} item revenue
            </p>
            {compact && (
              <ol className="sales-product-bars" aria-label="Top five products">
                {report.products.slice(0, 5).map((product) => {
                  const value =
                    metric === "QUANTITY"
                      ? BigInt(product.quantity)
                      : BigInt(product.revenue.replace(".", ""));
                  const max =
                    metric === "QUANTITY"
                      ? BigInt(report.products[0].quantity)
                      : BigInt(report.products[0].revenue.replace(".", ""));
                  const width =
                    max === 0n ? 0 : Number((value * 10000n) / max) / 100;
                  return (
                    <li key={product.productSnapshotId}>
                      <div>
                        <span>{product.productName}</span>
                        <strong>
                          {metric === "QUANTITY"
                            ? `${product.quantity.toLocaleString("en-PH")} sold`
                            : formatCartPrice(product.revenue)}
                        </strong>
                      </div>
                      <span className="sales-product-bar" aria-hidden="true">
                        <span style={{ width: `${width}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <ProductDetails compact={compact}>
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
                                      : BigInt(
                                          product.revenue.replace(".", ""),
                                        );
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
                            (other) =>
                              other.productName === product.productName,
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
            </ProductDetails>
          </>
        ))}
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
    </section>
  );
}

function ProductDetails({
  compact,
  children,
}: {
  compact: boolean;
  children: ReactNode;
}) {
  return compact ? (
    <details className="sales-data-details">
      <summary>View product details</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}
