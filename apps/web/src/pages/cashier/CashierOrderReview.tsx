import { useEffect, useRef, type ReactNode } from "react";
import { FiCheckCircle, FiArrowLeft } from "react-icons/fi";
import type { VerifyOrderQrResponse } from "@paserve/contracts";
import { formatCartPrice } from "../../lib/money";

export function CashierOrderReview({
  order,
  onNext,
  children,
  busy = false,
  source = "qr",
  purpose = "review",
  paymentMethod = "CASH",
}: {
  order: VerifyOrderQrResponse["order"];
  onNext: () => void;
  children?: ReactNode;
  busy?: boolean;
  source?: "qr" | "number";
  purpose?: "review" | "payment";
  paymentMethod?: "CASH" | "GCASH_MANUAL";
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section
      className="scanner-panel scanner-result cashier-review"
      aria-labelledby="verified-order-title"
    >
      <header className="cashier-review-header">
        <div>
          <p className="section-label">CUSTOMER ORDER / REVIEW</p>
          <h2 id="verified-order-title" ref={heading} tabIndex={-1}>
            {purpose === "payment"
              ? paymentMethod === "GCASH_MANUAL"
                ? "Record GCash payment"
                : "Collect cash"
              : "Review order"}
          </h2>
        </div>
        <p className="cashier-review-verified" role="status">
          <FiCheckCircle aria-hidden="true" />{" "}
          {purpose === "payment"
            ? "Confirmed order"
            : source === "qr"
              ? "Order QR verified"
              : "Order loaded by number"}
        </p>
      </header>
      <p className="scanner-description">
        {purpose === "payment"
          ? paymentMethod === "GCASH_MANUAL"
            ? "Check the saved total and verify receipt in the shop’s GCash account before recording payment."
            : "Check the saved total, collect the cash and return any change."
          : "Check the items, options, customer notes and total with the customer before taking payment or confirming the order."}
      </p>
      <div className="cashier-review-layout">
        <div className="cashier-review-receipt">
          <div className="cashier-review-order-number">
            <span>Order number</span>
            <strong>{order.orderNumber}</strong>
          </div>
          <h3>
            Order items ({quantity} {quantity === 1 ? "item" : "items"})
          </h3>
          <ol className="cashier-order-items">
            {order.items.map((item, index) => (
              <li key={index}>
                <div className="cashier-item-heading">
                  <h4>
                    {item.quantity} × {item.productName}
                  </h4>
                  <strong>{formatCartPrice(item.totalPrice)}</strong>
                </div>
                <p className="cashier-item-price">
                  {formatCartPrice(item.unitPrice)} each · line total includes
                  selected modifiers
                </p>
                {!!item.variants.length && (
                  <div>
                    <h5>Variants</h5>
                    <ul>
                      {item.variants.map((variant) => (
                        <li key={variant.id}>
                          {variant.name}{" "}
                          <span>
                            (
                            {variant.priceAdjustment === "0.00"
                              ? "no extra charge"
                              : `+${formatCartPrice(variant.priceAdjustment)} each`}
                            )
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!item.addOns.length && (
                  <div>
                    <h5>Add-ons</h5>
                    <ul>
                      {item.addOns.map((addOn) => (
                        <li key={addOn.id}>
                          {addOn.name}{" "}
                          <span>
                            (
                            {addOn.priceAdjustment === "0.00"
                              ? "no extra charge"
                              : `+${formatCartPrice(addOn.priceAdjustment)} each`}
                            )
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!item.variants.length && !item.addOns.length && (
                  <p>No modifiers selected.</p>
                )}
                {item.notes && (
                  <div className="cashier-item-note">
                    <h5>Customer note</h5>
                    <p>{item.notes}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
        <aside
          className="cashier-review-summary"
          aria-label="Order summary and actions"
        >
          <p className="section-label">AT A GLANCE</p>
          <dl>
            <div>
              <dt>Order type</dt>
              <dd>
                {order.mode === "DINE_IN"
                  ? `Dine-in · Table ${order.tableNumber}`
                  : "Takeout / pickup"}
              </dd>
            </div>
            <div>
              <dt>Order status</dt>
              <dd>{order.status.toLowerCase().replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Payment status</dt>
              <dd>{order.paymentStatus.toLowerCase().replaceAll("_", " ")}</dd>
            </div>
          </dl>
          <div className="cashier-review-total">
            <span>Order total (PHP)</span>
            <strong>{formatCartPrice(order.totalPrice)}</strong>
            <p>Includes selected modifiers.</p>
          </div>
          {purpose === "review" && (
            <p>
              These are the saved details for the submitted order. Verification
              does not confirm this order or record payment.
            </p>
          )}
          {children}
          <button className="secondary-button" onClick={onNext} disabled={busy}>
            <FiArrowLeft aria-hidden="true" /> Scan another order
          </button>
        </aside>
      </div>
    </section>
  );
}
