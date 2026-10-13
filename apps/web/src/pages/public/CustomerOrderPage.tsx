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
import { formatCartPrice } from "../../lib/money";
import "./customer-order-page.css";
import { OrderNumber } from "./OrderNumber";
import { menuTheme } from "../../lib/menu-theme";
import { readCustomerOrderQr } from "../../features/cart/customer-order-qr";
import { CustomerOrderQr } from "./CustomerOrderQr";

export function CustomerOrderPage() {
  const { shopSlug = "", orderId = "" } = useParams();
  const receipt = readOrderReceipt(shopSlug, orderId);
  const qr = readCustomerOrderQr(shopSlug, orderId);
  const heading = useRef<HTMLHeadingElement>(null);
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
                Order submitted
              </h1>
              <p className="order-receipt-intro">
                One more step before the kitchen.
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
            <div className="order-receipt-details">
              <CustomerOrderQr
                key={`qr:${shopSlug}:${orderId}`}
                credential={
                  qr && qr.orderNumber === receipt.orderNumber ? qr : null
                }
              />
              <OrderNumber
                key={`${shopSlug}:${orderId}`}
                value={receipt.orderNumber}
              />
              <dl>
                <div className="order-receipt-total">
                  <dt>
                    Order total <span>(PHP)</span>
                  </dt>
                  <dd aria-describedby="order-total-note">
                    {formatCartPrice(receipt.totalPrice)}
                  </dd>
                </div>
              </dl>
              <p id="order-total-note" className="order-receipt-note">
                This is the total saved for your submitted order.
              </p>
              <p className="order-receipt-note">
                <FiLock aria-hidden="true" /> Submission does not confirm
                payment.
              </p>
            </div>
            <section
              className="order-receipt-next"
              aria-labelledby="order-receipt-next-title"
            >
              <div className="order-receipt-next-topline">
                <span className="order-receipt-next-icon" aria-hidden="true">
                  <FiSmartphone />
                </span>
                <span className="order-receipt-status-label">
                  <FiClock aria-hidden="true" /> Pending
                </span>
              </div>
              <p className="section-label">At the counter</p>
              <h2 id="order-receipt-next-title">
                Show your order QR at the counter
              </h2>
              <p>
                Keep this screen open. If your QR is unavailable,{" "}
                {receipt.orderNumber
                  ? "give the staff your order number so they can assist you."
                  : "ask the staff for help with your submitted order."}
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
                <li aria-current="step">
                  <span aria-hidden="true">02</span>
                  <div>
                    <strong>Cashier confirmation &amp; payment</strong>
                    <p>Confirm and pay at the counter.</p>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true">03</span>
                  <div>
                    <strong>Kitchen queue</strong>
                    <p>Not queued yet.</p>
                  </div>
                </li>
              </ol>
              <div className="order-receipt-status" role="status">
                <span className="sr-only">Pending. </span>
                Your order is not yet in the kitchen queue. The cashier must
                confirm your order and payment before the kitchen starts
                preparing it.
              </div>
            </section>
          </div>
          <footer>
            <p>Need an update? Ask the counter staff.</p>
            <Link className="primary-button" to={menuUrl}>
              Back to menu <FiArrowUpRight aria-hidden="true" />
            </Link>
          </footer>
        </article>
      ) : (
        <section className="order-receipt-card order-receipt-unavailable">
          <h1 ref={heading} tabIndex={-1}>
            Order receipt unavailable
          </h1>
          <p role="alert">
            This receipt is not saved in this browser session. If you already
            submitted an order, ask the counter to check it before placing
            another.
          </p>
          <Link className="secondary-button" to={menuUrl}>
            <FiArrowLeft aria-hidden="true" /> Back to menu
          </Link>
        </section>
      )}
    </main>
  );
}
