import { dineInServiceLabel } from "@paserve/contracts";
import { RefreshButton } from "../../components/feedback/RefreshButton";
import { Button } from "../../components/ui/button";
import { ReceiptSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FiCoffee } from "react-icons/fi";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { useCustomerConfirmation } from "../../features/orders/useCustomerConfirmation";
import { trackingPath } from "../../features/orders/guest-tracking";
import { menuTheme } from "../../lib/menu-theme";
import "./customer-order-page.css";
import { ReceiptDocument } from "../../components/shops/ReceiptDocument";

export function CustomerReceiptPage() {
  const { shopSlug = "", orderId = "" } = useParams();
  const [attempt, setAttempt] = useState(0);
  return (
    <ReceiptRead
      key={`${shopSlug}:${orderId}:${attempt}`}
      shopSlug={shopSlug}
      orderId={orderId}
      retry={() => setAttempt((value) => value + 1)}
    />
  );
}

function ReceiptRead({
  shopSlug,
  orderId,
  retry,
}: {
  shopSlug: string;
  orderId: string;
  retry: () => void;
}) {
  const tracking = useCustomerConfirmation(shopSlug, orderId, null, { watchTerminal: true });
  // This route requires a protected read. Cached display data alone never unlocks it.
  const denied =
    tracking.state === "denied" || tracking.state === "unavailable";
  const paid = tracking.order?.status === "CONFIRMED" && tracking.order.paymentStatus === "PAID";
  const receipt = !denied && paid ? tracking.receipt : null;
  const loading = tracking.state === "loading";
  const heading = useRef<HTMLHeadingElement>(null);
  const title = receipt
    ? `Receipt ${receipt.orderNumber} · ${receipt.shopName}`
    : "Order receipt";
  useLayoutEffect(() => {
    document.title = `${title} · PaServe`;
    heading.current?.focus();
  }, [title, loading, denied]);
  const menuUrl =
    receipt?.mode === "DINE_IN"
      ? `/${encodeURIComponent(shopSlug)}/table/${encodeURIComponent(receipt.table!.code)}`
      : `/menu/${encodeURIComponent(shopSlug)}`;
  return (
    <main
      className="customer-order-page customer-receipt-page"
      style={menuTheme(receipt?.primaryColor, receipt?.accentColor)}
    >
      <header className="order-receipt-topline">
        <span>
          <FiCoffee aria-hidden="true" /> PaServe
          <span className="order-receipt-brand-divider" aria-hidden="true" />
          <span className="order-receipt-brand-note">Your receipt</span>
        </span>
        <AppearanceToggle />
      </header>
      {receipt ? (
        <article
          className="order-receipt-card"
          aria-labelledby="receipt-page-title"
        >
          <header className="order-receipt-heading refresh-heading">
            <div>
              <p className="section-label">Your digital copy</p>
              <h1 id="receipt-page-title" ref={heading} tabIndex={-1}>
                Receipt {receipt.orderNumber}
              </h1>
            </div>
            <RefreshButton label="Refresh receipt" onClick={retry} />
            <p className="order-receipt-intro refresh-heading-description">
              Digital receipt · {receipt.mode === "DINE_IN"
                ? `Dine-in · Table ${receipt.table!.number} · ${dineInServiceLabel(receipt.serviceType)}`
                : "Takeout / pickup"}
            </p>
          </header>
          <section
            className="order-receipt-details receipt-view-details"
          >
            {tracking.state === "stale" && (
              <InlineMessage tone="info" role="note">
                Unable to refresh this receipt. These are the last verified
                details.
              </InlineMessage>
            )}
            <ReceiptDocument {...receipt} orderContext={receipt.mode === "DINE_IN" ? `Dine-in · Table ${receipt.table!.number} · ${dineInServiceLabel(receipt.serviceType)}` : "Takeout / pickup"} />
          </section>
          <footer>
            <p>Keep this receipt for your records.</p>
            <div className="order-receipt-footer-actions">
              <Link
                className="primary-button"
                to={trackingPath(shopSlug, orderId)}
              >
                Back to order
              </Link>
              <Link className="secondary-button" to={menuUrl}>
                Back to menu
              </Link>
            </div>
          </footer>
        </article>
      ) : loading ? (
        <ReceiptSkeleton />
      ) : (
        <section className="order-receipt-card order-receipt-unavailable">
          <h1 ref={heading} tabIndex={-1}>
            Receipt unavailable
          </h1>
          <InlineMessage>
            {denied
              ? "Receipt access is unavailable. Open your private tracking link in this browser, or ask the counter staff for help using your order number."
              : tracking.state === "current" && !paid
                ? "Your receipt will be available after the cashier confirms your order and payment. You can follow your order on the tracking page."
                : "We could not load this receipt. Try again when connected, or ask the counter staff for help."}
          </InlineMessage>
          <Button variant="outline" size="inherit"
            type="button"
            className="secondary-button"
            onClick={retry}
          >
            Try again
          </Button>
          <Link
            className="secondary-button"
            to={trackingPath(shopSlug, orderId)}
          >
            Back to order
          </Link>
        </section>
      )}
    </main>
  );
}
