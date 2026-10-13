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
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="scanner-result" aria-labelledby="verified-order-title">
      <h3 id="verified-order-title" ref={heading} tabIndex={-1}>
        <FiCheckCircle aria-hidden="true" /> Order QR verified
      </h3>
      <p role="status">Order loaded for cashier review.</p>
      <dl>
        <div>
          <dt>Order number</dt>
          <dd>{order.orderNumber}</dd>
        </div>
        <div>
          <dt>Order type</dt>
          <dd>
            {order.mode === "DINE_IN"
              ? `Dine-in · Table ${order.tableNumber}`
              : "Takeout / pickup"}
          </dd>
        </div>
        <div>
          <dt>Saved total (PHP)</dt>
          <dd>{formatCartPrice(order.totalPrice)}</dd>
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
      <h4>Order items</h4>
      <ol className="cashier-order-items">
        {order.items.map((item, index) => (
          <li key={index}>
            <div className="cashier-item-heading">
              <h5>
                {item.quantity} × {item.productName}
              </h5>
              <strong>{formatCartPrice(item.totalPrice)}</strong>
            </div>
            <p className="cashier-item-price">
              {formatCartPrice(item.unitPrice)} each · line total includes
              selected modifiers
            </p>
            {!!item.variants.length && (
              <div>
                <h6>Variants</h6>
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
                <h6>Add-ons</h6>
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
                <h6>Customer note</h6>
                <p>{item.notes}</p>
              </div>
            )}
          </li>
        ))}
      </ol>
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
