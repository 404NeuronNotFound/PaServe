import { useEffect, useId, useRef } from "react";
import type { PublicTableContext } from "@paserve/contracts";
import {
  cartEstimatedSubtotal,
  cartItemCount,
  PRICE_PREVIEW_NOTICE,
  type CartItem,
} from "../../features/cart/cart";
import { formatCartPrice } from "../../lib/money";
import { FiShoppingBag, FiMapPin, FiEdit3, FiInfo } from "react-icons/fi";
import "./cart-review.css";

export interface CartReviewSnapshot {
  items: CartItem[];
  mode: "DINE_IN" | "TAKEOUT";
  table?: PublicTableContext;
  fingerprint: string;
}
export function CartReview({ review }: { review: CartReviewSnapshot }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
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
            {!!item.variants.length && (
              <p className="cart-review-options">
                Variants:{" "}
                {item.variants.map((option) => option.name).join(", ")}
              </p>
            )}
            {!!item.addOns.length && (
              <p className="cart-review-options">
                Add-ons: {item.addOns.map((option) => option.name).join(", ")}
              </p>
            )}
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
          <FiInfo aria-hidden="true" /> {PRICE_PREVIEW_NOTICE}
        </p>
      </div>
    </section>
  );
}
