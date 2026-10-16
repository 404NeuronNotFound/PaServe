import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FiArrowLeft,
  FiCheck,
  FiClock,
  FiCoffee,
  FiSmartphone,
  FiArrowUpRight,
  FiCheckCircle,
  FiLock,
} from "react-icons/fi";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { readOrderReceipt } from "../../features/cart/order-receipt";
import { receiptPath } from "../../features/orders/guest-tracking";
import { ReceiptTotals } from "./ReceiptTotals";
import "./customer-order-page.css";
import { menuTheme } from "../../lib/menu-theme";
import { readCustomerOrderQr } from "../../features/cart/customer-order-qr";
import { OrderReferenceCard } from "./OrderReferenceCard";
import { useCustomerConfirmation } from "../../features/orders/useCustomerConfirmation";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { GuestTrackingShare } from "./GuestTrackingShare";
import { ReceiptShopDetails } from "../../components/shops/ReceiptShopDetails";
import { ReceiptOrderItems } from "./ReceiptOrderItems";
import { ReceiptPaymentMethod } from "./ReceiptPaymentMethod";
import { ReceiptTimestamps } from "./ReceiptTimestamps";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";

export function CustomerOrderPage() {
  const { shopSlug = "", orderId = "" } = useParams();
  const qr = readCustomerOrderQr(shopSlug, orderId);
  const tracking = useCustomerConfirmation(
    shopSlug,
    orderId,
  );
  const receipt = tracking.receipt ?? readOrderReceipt(shopSlug, orderId);
  const savedStatus = tracking.order;
  const confirmed = savedStatus?.status === "CONFIRMED";
  const rejected = savedStatus?.status === "REJECTED";
  const preparation = confirmed ? savedStatus.preparationStatus : null;
  const ready = preparation === "READY";
  const completed = preparation === "COMPLETED";
  const preparationCopy =
    preparation === "PREPARING"
      ? {
          label: "Preparing",
          heading: "Order in preparation",
          title: "We're preparing your order",
          message: "The kitchen is actively preparing your order.",
          step: "Preparation in progress.",
        }
      : preparation === "READY"
        ? {
            label: "Ready",
            heading: "Order ready",
            title:
              receipt?.mode === "DINE_IN"
                ? "Ready for table service"
                : "Collect your order at the counter",
            message:
              receipt?.mode === "DINE_IN"
                ? "Your order is ready for table service."
                : "Your order is ready for pickup. Please collect it at the counter.",
            step:
              receipt?.mode === "DINE_IN"
                ? "Preparation complete. Ready to be served."
                : "Preparation complete. Ready to collect.",
          }
        : preparation === "COMPLETED"
          ? {
              label: "Completed",
              heading: "Order completed",
              title: "Your order is fulfilled",
              message:
                receipt?.mode === "DINE_IN"
                  ? "Your order has been served. Thank you!"
                  : "Your order has been collected. Thank you!",
              step: "Order fulfilled.",
            }
          : null;
  const statusLabel =
    preparationCopy?.label ??
    (confirmed ? "Confirmed" : rejected ? "Rejected" : "Waiting for Confirmation");
  const heading = useRef<HTMLHeadingElement>(null);
  const receiptDetails = useRef<HTMLElement>(null);
  const menuUrl =
    receipt?.mode === "DINE_IN"
      ? `/${encodeURIComponent(shopSlug)}/table/${encodeURIComponent(receipt.table!.code)}`
      : `/menu/${encodeURIComponent(shopSlug)}`;
  const pageTitle = receipt
    ? `Order ${receipt.orderNumber ?? "receipt"} · ${receipt.shopName} · PaServe`
    : "Order receipt unavailable · PaServe";
  useEffect(() => {
    document.title = pageTitle;
    heading.current?.focus();
  }, [shopSlug, orderId, pageTitle]);

  return (
    <main
      className="customer-order-page"
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
          aria-labelledby="order-receipt-title"
        >
          <header className="order-receipt-heading">
            <div>
              <p className="section-label">{receipt.shopName}</p>
              <h1 id="order-receipt-title" ref={heading} tabIndex={-1}>
                {preparationCopy
                  ? preparationCopy.heading
                  : confirmed
                    ? "Order confirmed"
                    : rejected
                      ? "Order rejected"
                      : "Waiting for Confirmation"}
              </h1>
              <p className="order-receipt-intro">
                {preparationCopy
                  ? preparationCopy.message
                  : confirmed
                    ? "The counter accepted your order and confirmed your payment. Your order is waiting for kitchen preparation."
                    : rejected
                      ? "Please ask the counter staff for help."
                      : "Your order has been saved. Cashier verification and payment are still required."}
              </p>
            </div>
            <p className="order-receipt-context">
              <FiCoffee aria-hidden="true" />
              {receipt.mode === "DINE_IN"
                ? `Dine-in · Table ${receipt.table!.number}`
                : "Takeout / pickup"}
            </p>
          </header>
          <div className="order-receipt-layout">
            <section
              className="order-receipt-details"
              id="order-receipt-details"
              aria-label="Order receipt"
              tabIndex={-1}
              ref={receiptDetails}
            >
              <ReceiptShopDetails details={receipt.shopDetails} />
              <OrderReferenceCard
                key={`${shopSlug}:${orderId}`}
                credential={
                  qr && qr.orderNumber === receipt.orderNumber ? qr : null
                }
                orderNumber={receipt.orderNumber}
              />
              <ReceiptOrderItems items={receipt.items} />
              <ReceiptPaymentMethod payment={receipt.payment} confirmed={confirmed} />
              <ReceiptTimestamps createdAt={receipt.createdAt} paidAt={receipt.paidAt}
                completedAt={receipt.completedAt} paid={confirmed || receipt.payment != null} />
              <ReceiptTotals receipt={receipt} />
              <p className="order-receipt-note">
                <FiLock aria-hidden="true" />{" "}
                {confirmed
                  ? "Payment confirmed by the cashier."
                  : receipt.payment
                    ? "Payment method shown from your last saved receipt."
                    : "Payment has not been confirmed by the cashier."}
              </p>
              {tracking.state === "current" && (
                <GuestTrackingShare key={`share:${shopSlug}:${orderId}`} shopSlug={shopSlug} orderId={orderId} orderNumber={receipt.orderNumber} />
              )}
            </section>
            <section
              className="order-receipt-next"
              aria-labelledby="order-receipt-next-title"
            >
              <div className="order-receipt-next-topline">
                <span className="order-receipt-next-icon" aria-hidden="true">
                  {ready || completed ? <FiCheckCircle /> : <FiSmartphone />}
                </span>
                <span className="order-receipt-status-label">
                  {ready || completed ? (
                    <FiCheckCircle aria-hidden="true" />
                  ) : (
                    <FiClock aria-hidden="true" />
                  )} {statusLabel}
                </span>
              </div>
              <p className="section-label">
                {completed
                  ? "Fulfilled"
                  : preparation === "PREPARING"
                  ? "In the kitchen"
                  : ready
                    ? "Ready for you"
                    : confirmed
                      ? "With your team"
                      : "At the counter"}
              </p>
              <h2 id="order-receipt-next-title">
                {preparationCopy
                  ? preparationCopy.title
                  : confirmed
                    ? "Your order is confirmed"
                    : rejected
                      ? "Please speak to the counter staff"
                      : "Show your order QR at the counter"}
              </h2>
              <p>
                {completed ? (
                  "Keep this receipt for your records."
                ) : ready ? (
                  receipt.mode === "DINE_IN" ? (
                    `Please stay at Table ${receipt.table!.number} for service.`
                  ) : (
                    "Have your order number ready when collecting your order."
                  )
                ) : preparation === "PREPARING" ? (
                  "Preparation times vary. Watch this page for the Ready status."
                ) : confirmed ? (
                  "Keep your order number handy for pickup or table service."
                ) : rejected ? (
                  "Your order was not accepted. Ask staff before placing another order."
                ) : (
                  <>
                    Keep this screen open. If your QR is unavailable,{" "}
                    {receipt.orderNumber
                      ? "give the staff your order number so they can assist you."
                      : "ask the staff for help with your submitted order."}
                  </>
                )}
              </p>
              <ol
                className="order-receipt-progress"
                aria-label="Order progress"
              >
                <li className="is-complete">
                  <span aria-hidden="true">
                    <FiCheck />
                  </span>
                  <div>
                    <strong>Submitted</strong>
                    <p>Your order has been saved.</p>
                  </div>
                  <FiCheckCircle aria-hidden="true" />
                </li>
                <li
                  className={confirmed ? "is-complete" : undefined}
                  aria-current={!confirmed && !rejected ? "step" : undefined}
                >
                  <span aria-hidden="true">02</span>
                  <div>
                    <strong>Cashier verification &amp; payment</strong>
                    <p>
                      {confirmed
                        ? "Confirmed and paid."
                        : "Show your QR or order number to the cashier, then pay at the counter."}
                    </p>
                  </div>
                </li>
                <li
                  className={completed ? "is-complete" : undefined}
                  aria-current={confirmed && !completed ? "step" : undefined}
                >
                  <span aria-hidden="true">03</span>
                  <div>
                    <strong>
                      {preparationCopy
                        ? "Kitchen preparation"
                        : "Kitchen queue"}
                    </strong>
                    <p>
                      {preparationCopy
                        ? preparationCopy.step
                        : confirmed
                          ? "Waiting for preparation to start."
                          : "Not queued yet."}
                    </p>
                  </div>
                </li>
              </ol>
              <div className="order-receipt-status" role="status" aria-atomic="true">
                <span className="sr-only">{statusLabel}. </span>
                {preparationCopy ? (
                  preparationCopy.message
                ) : confirmed ? (
                  "The counter accepted your order and confirmed your payment. The kitchen will start preparing it next."
                ) : rejected ? (
                  "This order was rejected. Ask the counter staff for assistance."
                ) : (
                  <>
                    Your order is not yet in the kitchen queue. The cashier must
                    confirm your order and payment before the kitchen starts
                    preparing it.
                  </>
                )}
              </div>
              {tracking.state !== "current" && (
                <InlineMessage tone="info" role="note" aria-live="polite" aria-atomic="true">
                  {tracking.state === "loading"
                    ? "Checking the latest order status. The receipt shows the last saved status."
                    : tracking.state === "denied" || tracking.state === "unavailable"
                      ? "Live tracking is unavailable for this receipt. The status shown may be out of date. Open your private tracking link again or ask the counter staff for the latest update."
                      : "Unable to refresh your order status. The status shown may be out of date. We will retry automatically; you can also ask the counter staff."}
                </InlineMessage>
              )}
              {completed && savedStatus?.completedAt && (
                <p className="order-receipt-note">
                  Completed at{" "}
                  <time dateTime={savedStatus.completedAt}>
                    {formatReceiptDateTime(savedStatus.completedAt)}
                  </time>
                </p>
              )}
            </section>
          </div>
          <footer>
            <p>
              {completed
                ? "Thank you for your order."
                : "Need an update? Ask the counter staff."}
            </p>
            <div className="order-receipt-footer-actions">
              {tracking.state === "current" && (
                <Link
                  className="secondary-button"
                  to={receiptPath(shopSlug, orderId)}
                >
                  View receipt
                </Link>
              )}
              <Link className="primary-button" to={menuUrl}>
                Back to menu <FiArrowUpRight aria-hidden="true" />
              </Link>
            </div>
          </footer>
        </article>
      ) : tracking.state === "loading" ? (
        <section className="order-receipt-card order-receipt-unavailable" role="status">
          Loading your order…
        </section>
      ) : (
        <section className="order-receipt-card order-receipt-unavailable">
          <h1 ref={heading} tabIndex={-1}>
            Order receipt unavailable
          </h1>
          <p role="alert">
            We could not reopen this receipt. Open your private tracking link,
            or ask the counter to check it using your order number before placing
            another order.
          </p>
          <Link className="secondary-button" to={menuUrl}>
            <FiArrowLeft aria-hidden="true" /> Back to menu
          </Link>
        </section>
      )}
    </main>
  );
}
