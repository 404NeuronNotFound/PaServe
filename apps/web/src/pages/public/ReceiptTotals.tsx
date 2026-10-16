import { useId } from "react";
import type { OrderReceipt } from "../../features/cart/order-receipt";
import { formatCartPrice } from "../../lib/money";

export function ReceiptTotals({
  receipt,
}: {
  receipt: Pick<OrderReceipt, "totalPrice" | "subtotalPrice">;
}) {
  const note = useId();
  return (
    <>
      <dl className="receipt-totals">
        {receipt.subtotalPrice !== undefined && (
          <div className="order-receipt-subtotal">
            <dt>
              Subtotal <span>(PHP)</span>
            </dt>
            <dd>{formatCartPrice(receipt.subtotalPrice)}</dd>
          </div>
        )}
        <div className="order-receipt-total">
          <dt>
            Order total <span>(PHP)</span>
          </dt>
          <dd aria-describedby={note}>{formatCartPrice(receipt.totalPrice)}</dd>
        </div>
      </dl>
      <p id={note} className="order-receipt-note">
        This is the total saved for your submitted order.
      </p>
    </>
  );
}
