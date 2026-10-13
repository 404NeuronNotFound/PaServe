import { useEffect, useRef } from "react";
import { FiCheckCircle } from "react-icons/fi";
import type { VerifyOrderQrResponse } from "@paserve/contracts";
import { formatCartPrice } from "../../lib/money";

export function CashierOrderReview({
  order,
  onNext,
}: {
  order: VerifyOrderQrResponse["order"];
  onNext: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="scanner-panel scanner-result cashier-review" aria-labelledby="verified-order-title">
      <h2 id="verified-order-title" ref={heading} tabIndex={-1}>
        Review order
      </h2>
      <p className="cashier-review-verified" role="status">
        <FiCheckCircle aria-hidden="true" /> Order QR verified
      </p>
      <p>Check the items, options, customer notes and total with the customer before taking payment or confirming the order.</p>
      <div className="cashier-review-order-number">
        <span>Order number</span>
        <strong>{order.orderNumber}</strong>
      </div>
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
      <h3>Order items ({quantity} {quantity === 1 ? "item" : "items"})</h3>
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
      <div className="cashier-review-total">
        <span>Order total (PHP)</span>
        <strong>{formatCartPrice(order.totalPrice)}</strong>
        <p>Includes selected modifiers.</p>
      </div>
      <p>
        These are the saved details for the submitted order. Verification does
        not confirm this order or record payment.
      </p>
      <button className="secondary-button" onClick={onNext}>
        Scan another order
      </button>
    </section>
  );
}
