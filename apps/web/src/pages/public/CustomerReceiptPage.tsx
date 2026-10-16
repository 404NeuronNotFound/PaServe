import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FiCoffee } from "react-icons/fi";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ReceiptShopDetails } from "../../components/shops/ReceiptShopDetails";
import { useCustomerConfirmation } from "../../features/orders/useCustomerConfirmation";
import { trackingPath } from "../../features/orders/guest-tracking";
import { menuTheme } from "../../lib/menu-theme";
import { OrderNumber } from "./OrderNumber";
import { ReceiptOrderItems } from "./ReceiptOrderItems";
import { ReceiptPaymentMethod } from "./ReceiptPaymentMethod";
import { ReceiptTimestamps } from "./ReceiptTimestamps";
import { ReceiptTotals } from "./ReceiptTotals";
import "./customer-order-page.css";

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
  const tracking = useCustomerConfirmation(shopSlug, orderId);
  // This route requires a protected read. Cached display data alone never unlocks it.
  const denied =
    tracking.state === "denied" || tracking.state === "unavailable";
  const receipt = denied ? null : tracking.receipt;
  const heading = useRef<HTMLHeadingElement>(null);
  const title = receipt
    ? `Receipt ${receipt.orderNumber} · ${receipt.shopName}`
    : "Order receipt";
  useEffect(() => {
    document.title = `${title} · PaServe`;
    heading.current?.focus();
  }, [title]);
  const paid = tracking.order?.paymentStatus === "PAID";
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
          <header className="order-receipt-heading">
            <div>
              <p className="section-label">{receipt.shopName}</p>
              <h1 id="receipt-page-title" ref={heading} tabIndex={-1}>
                Receipt {receipt.orderNumber}
              </h1>
              <p className="order-receipt-intro">
                {receipt.mode === "DINE_IN"
                  ? `Dine-in · Table ${receipt.table!.number}`
                  : "Takeout / pickup"}
              </p>
            </div>
            <p className="order-receipt-context">
              {paid
                ? "Paid"
                : tracking.order?.status === "REJECTED"
                  ? "Rejected · Unpaid"
                  : "Unpaid"}
            </p>
          </header>
          <section
            className="order-receipt-details receipt-view-details"
            aria-label="Order receipt"
          >
            {tracking.state === "stale" && (
              <InlineMessage tone="info" role="note">
                Unable to refresh this receipt. These are the last verified
                details.
              </InlineMessage>
            )}
            <div className="receipt-view-layout">
              <section aria-label="Shop and purchased items">
                <ReceiptShopDetails details={receipt.shopDetails} />
                <OrderNumber value={receipt.orderNumber} />
                <ReceiptOrderItems items={receipt.items} />
              </section>
              <aside aria-label="Payment and totals">
                <ReceiptPaymentMethod
                  payment={receipt.payment}
                  confirmed={paid}
                />
                <ReceiptTotals receipt={receipt} />
                <ReceiptTimestamps
                  createdAt={receipt.createdAt}
                  paidAt={receipt.paidAt}
                  completedAt={receipt.completedAt}
                  paid={paid}
                />
              </aside>
            </div>
          </section>
          <footer>
            <p>Keep this receipt for your records.</p>
            <div className="order-receipt-footer-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={retry}
              >
                Refresh receipt
              </button>
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
      ) : (
        <section className="order-receipt-card order-receipt-unavailable">
          <h1 ref={heading} tabIndex={-1}>
            {tracking.state === "loading"
              ? "Loading receipt"
              : "Receipt unavailable"}
          </h1>
          {tracking.state === "loading" ? (
            <p role="status">Checking receipt access…</p>
          ) : (
            <>
              <InlineMessage>
                {denied
                  ? "Receipt access is unavailable. Open your private tracking link in this browser, or ask the counter staff for help using your order number."
                  : "We could not load this receipt. Try again when connected, or ask the counter staff for help."}
              </InlineMessage>
              <button
                type="button"
                className="secondary-button"
                onClick={retry}
              >
                Try again
              </button>
            </>
          )}
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
