import type { CSSProperties, ReactNode } from "react";
import type { MenuLayout } from "@paserve/contracts";
import "./loading-skeleton.css";

/** Decorative shapes never expose fake values or controls to assistive technology. */
export function SkeletonBlock({
  width,
  height,
  className = "",
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton-block ${className}`}
      style={{ width, height }}
    />
  );
}

function LoadingRegion({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`loading-skeleton ${className}`}>
      {/* Readable when explored, without a chorus of live updates as sections load. */}
      <span className="sr-only" role="status" aria-live="off" aria-atomic="true">
        {label}
      </span>
      <div aria-busy="true" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

function Lines() {
  return (
    <div className="skeleton-lines">
      <SkeletonBlock width="68%" height={20} />
      <SkeletonBlock width="90%" />
      <SkeletonBlock width="48%" />
    </div>
  );
}

/** Safe before validation: no account or shop data, links, or tools. */
export function AccessSkeleton({
  label,
  view = "workspace",
}: {
  label: string;
  view?: "workspace" | "cashier" | "kitchen" | "invitation";
}) {
  return (
    <LoadingRegion label={label} className="skeleton-access">
      <div className="skeleton-form-fields">
        {view !== "invitation" && (
          <div className="skeleton-lines">
            <SkeletonBlock width={140} />
            <SkeletonBlock width="55%" height={48} />
            <SkeletonBlock width="45%" />
          </div>
        )}
        {view === "invitation" ? (
          <div className="skeleton-access-panel skeleton-form-fields">
            <Lines />
            <SkeletonBlock height={48} />
          </div>
        ) : view === "cashier" ? (
          <>
            <div className="skeleton-actions">
              {[0, 1, 2].map((i) => (
                <SkeletonBlock key={i} width={140} height={32} />
              ))}
            </div>
            <div className="cashier-scanner">
              <div className="scanner-panel skeleton-form-fields">
                <SkeletonBlock width="65%" height={28} />
                <SkeletonBlock className="skeleton-access-camera" />
                <SkeletonBlock width={160} height={44} />
              </div>
              <div className="scanner-panel skeleton-form-fields">
                <SkeletonBlock width="70%" height={28} />
                <Lines />
                <SkeletonBlock height={48} />
                <SkeletonBlock height={44} />
              </div>
            </div>
          </>
        ) : (
          <>
            <SkeletonBlock height={48} />
            <div
              className={
                view === "kitchen" ? "kitchen-tickets" : "skeleton-access-grid"
              }
            >
              {[0, 1, 2].map((i) => (
                <div
                  className="skeleton-access-panel skeleton-form-fields"
                  key={i}
                >
                  <SkeletonBlock width="60%" height={28} />
                  <Lines />
                  {view === "kitchen" && (
                    <>
                      <div className="skeleton-divider" />
                      <Lines />
                    </>
                  )}
                  <SkeletonBlock width="65%" height={44} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </LoadingRegion>
  );
}

export function MenuSkeleton({
  label = "Loading menu…",
  preview = false,
  layout,
  banner,
  count = 6,
}: {
  label?: string;
  preview?: boolean;
  layout?: MenuLayout;
  banner?: boolean;
  count?: number;
}) {
  const Root = preview ? "div" : "main";
  return (
    <Root
      className="public-menu menu-skeleton-page"
      data-layout={layout ?? "loading"}
    >
      <LoadingRegion label={label}>
        <div className="menu-topline">
          <SkeletonBlock width={180} height={24} />
          {!preview && <SkeletonBlock width={44} height={44} />}
        </div>
        <div className="menu-shop-hero">
          {banner === undefined ? (
            <SkeletonBlock className="skeleton-menu-hero" />
          ) : (
            <>
              {banner && (
                <div className="shop-banner skeleton-menu-banner">
                  <SkeletonBlock height="100%" />
                </div>
              )}
              <div className="public-menu-header">
                <SkeletonBlock className="shop-logo" />
                <div className="menu-shop-copy">
                  <SkeletonBlock width={90} />
                  <SkeletonBlock width="65%" height={48} />
                  <SkeletonBlock width="85%" />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="menu-browse-bar">
          <SkeletonBlock height={50} />
          <div className="skeleton-actions">
            <SkeletonBlock width={90} height={40} />
            <SkeletonBlock width={110} height={40} />
            <SkeletonBlock width={90} height={40} />
          </div>
        </div>
        <div className="menu-section-heading">
          <SkeletonBlock width={180} height={28} />
        </div>
        {!layout ? (
          <div className="skeleton-menu-content">
            <SkeletonBlock height={180} />
            <SkeletonBlock height={180} />
          </div>
        ) : (
          <ul className="menu-products">
            {Array.from({ length: count }, (_, i) => (
              <li key={i} className="menu-product-card">
                <SkeletonBlock className="menu-product-media" />
                <div className="menu-product-body">
                  <Lines />
                  <div className="menu-product-footer">
                    <SkeletonBlock width={80} height={24} />
                    <SkeletonBlock width={110} height={44} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </LoadingRegion>
    </Root>
  );
}

export function ProductsSkeleton() {
  return (
    <LoadingRegion label="Loading products…">
      <div className="product-group">
        <div className="product-group-heading">
          <SkeletonBlock width={200} height={28} />
        </div>
        <ul className="products-list">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i}>
              <SkeletonBlock className="product-emblem" />
              <div className="product-card-details">
                <Lines />
                <div className="skeleton-actions">
                  <SkeletonBlock width={90} height={28} />
                </div>
              </div>
              <div className="product-card-actions">
                <SkeletonBlock width={80} height={24} />
                <div className="skeleton-actions">
                  <SkeletonBlock width={64} height={44} />
                  <SkeletonBlock width={72} height={44} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </LoadingRegion>
  );
}

export function OrderListSkeleton({
  label,
  kitchen = false,
  history = false,
}: {
  label: string;
  kitchen?: boolean;
  history?: boolean;
}) {
  return (
    <LoadingRegion label={label}>
      <ul
        className={
          kitchen
            ? history
              ? "kitchen-history"
              : "kitchen-tickets"
            : "active-orders-list"
        }
      >
        {Array.from({ length: 3 }, (_, i) => (
          <li
            key={i}
            className={
              kitchen ? (history ? "" : "kitchen-ticket") : "active-order-card"
            }
          >
            {kitchen && history ? (
              <>
                <div className="kitchen-history-check">
                  <SkeletonBlock width={30} height={30} />
                </div>
                <div className="kitchen-history-identity">
                  <Lines />
                </div>
                <div className="kitchen-history-summary">
                  <Lines />
                </div>
                <time>
                  <SkeletonBlock width={120} />
                </time>
                <div className="skeleton-history-action">
                  <SkeletonBlock width={110} height={44} />
                </div>
              </>
            ) : kitchen ? (
              <div className="skeleton-ticket">
                <Lines />
                <div className="skeleton-divider" />
                <Lines />
                <SkeletonBlock height={44} />
              </div>
            ) : (
              <>
                <div className="active-order-identity">
                  <Lines />
                </div>
                <div className="active-order-state">
                  <SkeletonBlock width={110} height={28} />
                  <SkeletonBlock width={80} />
                </div>
                <div className="active-order-timing">
                  <Lines />
                </div>
                <div className="active-order-total">
                  <SkeletonBlock width={80} height={24} />
                </div>
                <div className="owner-order-detail-link">
                  <SkeletonBlock width={110} height={20} />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}

export function ListSkeleton({
  label,
  tables = false,
}: {
  label: string;
  tables?: boolean;
}) {
  return (
    <LoadingRegion label={label}>
      <ul className={tables ? "tables-list" : "skeleton-list"}>
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i}>
            <Lines />
            <div className="skeleton-actions">
              <SkeletonBlock width={80} height={28} />
              <SkeletonBlock width={100} height={44} />
            </div>
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}

export function MetricsSkeleton({
  label = "Loading sales…",
}: {
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="sales-summary">
        <div className="sales-hero skeleton-metric">
          <div className="sales-hero-top">
            <SkeletonBlock width="55%" />
            <SkeletonBlock width={35} height={35} />
          </div>
          <div className="sales-hero-date">
            <SkeletonBlock width="70%" height={12} />
          </div>
          <div className="sales-amount">
            <SkeletonBlock width="80%" height="1em" />
          </div>
          <div className="sales-hero-footer">
            <SkeletonBlock width="75%" height={12} />
          </div>
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div className="sales-metric" key={i}>
            <div className="sales-metric-top">
              <SkeletonBlock width={35} height={35} />
            </div>
            <h2>
              <SkeletonBlock width="85%" height="1em" />
            </h2>
            <div className="sales-amount">
              <SkeletonBlock width="80%" height="1em" />
            </div>
            <p>
              <SkeletonBlock width="85%" height="1em" />
            </p>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function ReportSkeleton({
  label,
  chart = false,
}: {
  label: string;
  chart?: boolean;
}) {
  return (
    <LoadingRegion label={label} className="skeleton-report">
      <SkeletonBlock width="55%" height={24} />
      {chart && (
        <div className="skeleton-chart">
          <SkeletonBlock height="100%" />
        </div>
      )}
      <div className="skeleton-report-rows">
        {Array.from({ length: 5 }, (_, i) => (
          <div className="skeleton-report-row" key={i}>
            <SkeletonBlock width="80%" />
            <SkeletonBlock width="60%" />
            <SkeletonBlock width="70%" />
            <SkeletonBlock width="65%" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function ProductDetailsSkeleton() {
  return (
    <LoadingRegion
      label="Loading product details…"
      className="customer-dialog-body"
    >
      <div className="product-details-summary">
        <SkeletonBlock className="product-details-placeholder" />
        <Lines />
      </div>
      <div className="skeleton-form-fields">
        <SkeletonBlock width="40%" height={24} />
        <SkeletonBlock height={56} />
        <SkeletonBlock height={56} />
        <SkeletonBlock height={96} />
        <SkeletonBlock height={44} />
      </div>
    </LoadingRegion>
  );
}

export function OrderDetailsSkeleton() {
  return (
    <LoadingRegion label="Loading saved order details…">
      <div className="owner-order-detail-grid">
        <div className="owner-order-panel skeleton-form-fields">
          <SkeletonBlock width="60%" height={28} />
          <Lines />
          <div className="skeleton-divider" />
          <Lines />
          <Lines />
          <SkeletonBlock width="70%" height={28} />
        </div>
        <div className="owner-order-panel skeleton-form-fields">
          <SkeletonBlock width="65%" height={28} />
          <Lines />
          <Lines />
          <Lines />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function SalesReportSkeleton({
  kind,
  label,
  controls = true,
}: {
  kind: "trends" | "products" | "hours" | "payments" | "recent";
  label: string;
  controls?: boolean;
}) {
  return (
    <LoadingRegion label={label} className={`skeleton-sales skeleton-sales-${kind}`}>
      <SkeletonBlock width={kind === "payments" ? "100%" : "55%"} height={controls && (kind === "payments" || kind === "products") ? 50 : 14} />
      {kind === "trends" && (
        <div className="sales-trend-chart skeleton-sales-chart">
          <SkeletonBlock width="55%" />
          <div className="skeleton-sales-columns">
            <SkeletonBlock height="100%" />
            <SkeletonBlock height="100%" />
          </div>
          <SkeletonBlock width="65%" />
        </div>
      )}
      {kind === "hours" && (
        <div className="skeleton-sales-hours">
          {Array.from({ length: 24 }, (_, i) => <SkeletonBlock key={i} height="100%" />)}
        </div>
      )}
      {kind === "payments" && (
        <>
          <div className="sales-payment-visual">
            <SkeletonBlock className="skeleton-sales-ring" width={132} height={132} />
            <div className="sales-payment-context skeleton-lines">
              <SkeletonBlock width="45%" />
              <SkeletonBlock width="90%" height={36} />
              <SkeletonBlock width="70%" />
            </div>
          </div>
          <SkeletonBlock height={40} />
        </>
      )}
      {(kind === "products" || kind === "payments" || kind === "recent") && (
        <div className="skeleton-sales-rows">
          {Array.from({ length: kind === "products" ? 5 : kind === "payments" ? 4 : 3 }, (_, i) => (
            <div className="skeleton-sales-row" key={i}>
              <div className="skeleton-sales-row-heading">
                <SkeletonBlock width={kind === "recent" ? "45%" : "35%"} />
                <SkeletonBlock width="20%" />
              </div>
              <SkeletonBlock width={kind === "recent" ? "60%" : "100%"} height={kind === "recent" ? 14 : 6} />
            </div>
          ))}
        </div>
      )}
      <div className="skeleton-sales-footer"><SkeletonBlock width="55%" height={20} /></div>
    </LoadingRegion>
  );
}

export function PreparationMetricSkeleton() {
  return (
    <LoadingRegion label="Loading average preparation time…" className="skeleton-sales skeleton-sales-preparation">
      <div className="prep-time-display">
        <SkeletonBlock className="skeleton-sales-ring" width={72} height={72} />
        <div className="prep-time-average skeleton-prep-value">
          <SkeletonBlock width="85%" height={42} />
          <SkeletonBlock width="75%" />
        </div>
        <div className="prep-time-sample skeleton-lines">
          <SkeletonBlock width="75%" />
          <SkeletonBlock height={6} />
          <SkeletonBlock width="90%" />
        </div>
      </div>
      <div className="skeleton-sales-footer"><SkeletonBlock width="80%" height={20} /></div>
    </LoadingRegion>
  );
}

export function StaffSkeleton() {
  return (
    <LoadingRegion label="Checking staff access…">
      <div className="staff-workspace">
        <div className="staff-heading">
          <div className="skeleton-lines">
            <SkeletonBlock width={120} />
            <SkeletonBlock width="55%" height={50} />
            <SkeletonBlock width="45%" />
          </div>
          <SkeletonBlock width={160} height={48} />
        </div>
        <div className="staff-grid">
          <div className="staff-team-panels">
            {[0, 1].map((panel) => (
              <div className="staff-panel skeleton-form-fields" key={panel}>
                <SkeletonBlock width="55%" height={28} />
                <SkeletonBlock height={44} />
                <Lines />
                <Lines />
              </div>
            ))}
          </div>
          <div className="staff-panel skeleton-form-fields">
            <SkeletonBlock width="70%" height={28} />
            <Lines />
            <SkeletonBlock height={48} />
            <SkeletonBlock height={48} />
            <SkeletonBlock height={44} />
          </div>
        </div>
        <SkeletonBlock height={68} />
      </div>
    </LoadingRegion>
  );
}

export function ReceiptSkeleton({ tracking = false }: { tracking?: boolean }) {
  return (
    <LoadingRegion
      label={tracking ? "Loading your order…" : "Checking receipt access…"}
      className="order-receipt-card"
    >
      <div className="order-receipt-heading">
        <div className="skeleton-lines skeleton-receipt-heading">
          <SkeletonBlock width={120} />
          <SkeletonBlock height={52} />
          <SkeletonBlock width="65%" />
        </div>
      </div>
      {tracking ? (
        <div className="order-receipt-layout">
          <div className="skeleton-lines">
            <SkeletonBlock className="skeleton-order-reference" />
            <SkeletonBlock width="55%" height={24} />
            <SkeletonBlock height={44} />
          </div>
          <div className="skeleton-ticket">
            <SkeletonBlock width={110} height={28} />
            <Lines />
            <div className="skeleton-divider" />
            <Lines />
            <Lines />
          </div>
        </div>
      ) : (
        <div className="skeleton-receipt-document">
          <SkeletonBlock width="55%" height={40} />
          <Lines />
          <div className="skeleton-divider" />
          <Lines />
          <Lines />
          <div className="skeleton-divider" />
          <SkeletonBlock width="80%" height={28} />
          <Lines />
        </div>
      )}
    </LoadingRegion>
  );
}

export function FormSkeleton({
  label,
  branding = false,
}: {
  label: string;
  branding?: boolean;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="skeleton-form-fields">
        <SkeletonBlock width="45%" height={48} />
        {branding && (
          <div className="settings-assets">
            <SkeletonBlock height={240} />
            <SkeletonBlock height={240} />
          </div>
        )}
        <div className="skeleton-form-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skeleton-lines" key={i}>
              <SkeletonBlock width="40%" />
              <SkeletonBlock height={48} />
            </div>
          ))}
        </div>
        <SkeletonBlock height={120} />
        <SkeletonBlock width={150} height={44} />
      </div>
    </LoadingRegion>
  );
}
