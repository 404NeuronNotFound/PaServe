import { useEffect, useId, useRef } from "react";
import type { PublicTableContext } from "@paserve/contracts";
import {
  cartEstimatedSubtotal,
  cartItemCount,
  PRICE_PREVIEW_NOTICE,
  type CartItem,
} from "../../features/cart/cart";
import { formatCartPrice } from "../../lib/money";
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
      <dl className="cart-review-type">
        <dt>Order type</dt>
        <dd>{review.mode === "TAKEOUT" ? "Takeout / pickup" : "Dine-in"}</dd>
        {review.mode === "DINE_IN" && review.table && (
          <>
            <dt>Table</dt>
            <dd>{review.table.number}</dd>
          </>
        )}
      </dl>
      <p>
        {cartItemCount(review.items)} items · {review.items.length} configured{" "}
        {review.items.length === 1 ? "line" : "lines"}
      </p>
      <ol className="cart-review-items" aria-label="Reviewed items">
        {review.items.map((item) => (
          <li key={item.lineId}>
            <div className="cart-review-line-heading">
              <h3>{item.productName}</h3>
              <strong>{formatCartPrice(item.totalPrice)}</strong>
            </div>
            <p>
              Quantity: {item.quantity} · {formatCartPrice(item.unitPrice)} each
            </p>
            {!!item.variants.length && (
              <p>
                Variants:{" "}
                {item.variants.map((option) => option.name).join(", ")}
              </p>
            )}
            {!!item.addOns.length && (
              <p>
                Add-ons: {item.addOns.map((option) => option.name).join(", ")}
              </p>
            )}
            <p className="cart-review-notes">Notes: {item.notes || "None"}</p>
          </li>
        ))}
      </ol>
      <p className="cart-review-subtotal">
        <span>Estimated subtotal</span>
        <strong>{formatCartPrice(cartEstimatedSubtotal(review.items))}</strong>
      </p>
      <p className="field-hint">{PRICE_PREVIEW_NOTICE}</p>
    </section>
  );
}
