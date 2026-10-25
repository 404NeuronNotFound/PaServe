import { useEffect, useId, useRef } from "react";
import { dineInServiceLabel, type DineInServiceType, type PublicTableContext } from "@paserve/contracts";
import {
  cartEstimatedSubtotal,
  cartItemCount,
  type CartItem,
} from "../../features/cart/cart";
import { formatCartPrice } from "../../lib/money";
import { FiShoppingBag, FiMapPin, FiEdit3, FiInfo } from "react-icons/fi";
import "./cart-review.css";
import { CartItemConfiguration } from "./CartItemConfiguration";

export interface CartReviewSnapshot {
  items: CartItem[];
  mode: "DINE_IN" | "TAKEOUT";
  serviceType?: DineInServiceType;
  table?: PublicTableContext;
  fingerprint: string;
}
export function CartReview({ review }: { review: CartReviewSnapshot }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [review.items]);
  return (
    <section className="cart-review" aria-labelledby={id}>
      <h2 id={id} tabIndex={-1} ref={heading}>
        Review your order
      </h2>
      <p className="cart-review-intro">
        A final look before you place your order.
      </p>
      <div className="cart-review-context">
        <span className="cart-review-context-icon" aria-hidden="true">
          <FiShoppingBag />
        </span>
        <dl className="cart-review-type">
          <div>
            <dt>Order type</dt>
            <dd>
              {review.mode === "TAKEOUT" ? "Takeout / pickup" : "Dine-in"}
            </dd>
          </div>
          {review.mode === "DINE_IN" && review.table && (
            <div className="cart-review-table">
              <dt>Table</dt>
              <dd>
                <FiMapPin aria-hidden="true" /> {review.table.number}
              </dd>
            </div>
          )}
          {review.mode === "DINE_IN" && (
            <div><dt>Service</dt><dd>{dineInServiceLabel(review.serviceType)}</dd></div>
          )}
        </dl>
      </div>
      <p className="cart-review-count">
        <span>Your picks</span>
        <span>
          {cartItemCount(review.items)}{" "}
          {cartItemCount(review.items) === 1 ? "item" : "items"} ·{" "}
          {review.items.length}{" "}
          {review.items.length === 1 ? "selection" : "selections"}
        </span>
      </p>
      <ol className="cart-review-items" aria-label="Reviewed items">
        {review.items.map((item) => (
          <li key={item.lineId}>
            <div className="cart-review-line-heading">
              <div className="cart-review-product">
                <span className="cart-review-quantity-badge" aria-hidden="true">
                  {item.quantity}×
                </span>
                <h3>{item.productName}</h3>
              </div>
              <strong>{formatCartPrice(item.totalPrice)}</strong>
            </div>
            <p className="cart-review-unit-price">
              Quantity: {item.quantity} · {formatCartPrice(item.unitPrice)} each
            </p>
            <CartItemConfiguration item={item} groupClassName="cart-review-options" />
            {item.notes && (
              <p className="cart-review-notes">
                <FiEdit3 aria-hidden="true" /> Notes: {item.notes}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="cart-review-estimate">
        <p className="cart-review-subtotal">
          <span>Estimated subtotal</span>
          <strong>
            {formatCartPrice(cartEstimatedSubtotal(review.items))}
          </strong>
        </p>
        <p className="field-hint">
          <FiInfo aria-hidden="true" /> We verify the total before saving your order.
          Any price change requires your confirmation.
        </p>
      </div>
    </section>
  );
}
