import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FiArrowLeft,
  FiCheck,
  FiClock,
  FiCoffee,
  FiSmartphone,
} from "react-icons/fi";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { readOrderReceipt } from "../../features/cart/order-receipt";
import { formatCartPrice } from "../../lib/money";
import "./customer-order-page.css";
import { OrderNumber } from "./OrderNumber";

export function CustomerOrderPage() {
  const { shopSlug = "", orderId = "" } = useParams();
  const receipt = readOrderReceipt(shopSlug, orderId);
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
    <main className="customer-order-page">
      <header className="order-receipt-topline">
        <span>
          <FiCoffee aria-hidden="true" /> PaServe
        </span>
        <AppearanceToggle />
      </header>
      {receipt ? (
        <article
          className="order-receipt-card"
          aria-labelledby="order-receipt-title"
        >
          <header className="order-receipt-heading">
            <span className="order-receipt-check" aria-hidden="true">
              <FiCheck />
            </span>
            <p className="section-label">{receipt.shopName}</p>
            <h1 id="order-receipt-title" ref={heading} tabIndex={-1}>
              Order submitted
            </h1>
            <p>
              {receipt.mode === "DINE_IN"
                ? `Dine-in · Table ${receipt.table!.number}`
                : "Takeout / pickup"}
            </p>
          </header>
          <div className="order-receipt-details">
            <OrderNumber
              key={`${shopSlug}:${orderId}`}
              value={receipt.orderNumber}
            />
            <dl>
              <div>
                <dt>Status</dt>
                <dd className="order-receipt-status" role="status">
                  <span className="order-receipt-status-label">
                    <FiClock aria-hidden="true" /> Pending confirmation
                  </span>
                  <p className="order-receipt-note">
                    Your order is not yet in the kitchen queue. Show your QR or
                    order number at the counter and wait for staff confirmation.
                  </p>
                </dd>
              </div>
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
              Submission does not confirm payment. Ask the counter for the
              latest order status.
            </p>
          </div>
          <section
            className="order-receipt-next"
            aria-labelledby="order-receipt-next-title"
          >
            <FiSmartphone aria-hidden="true" />
            <div>
              <p className="section-label">Next step</p>
              <h2 id="order-receipt-next-title">
                Show your order QR at the counter
              </h2>
              <p>
                Keep this screen open. If your QR is unavailable,{" "}
                {receipt.orderNumber
                  ? "give the staff your order number so they can assist you."
                  : "ask the staff for help with your submitted order."}
              </p>
            </div>
          </section>
          <footer>
            <Link className="secondary-button" to={menuUrl}>
              <FiArrowLeft aria-hidden="true" /> Back to menu
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
