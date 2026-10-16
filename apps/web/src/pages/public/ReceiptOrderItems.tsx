import { useId } from "react";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
import { formatCartPrice } from "../../lib/money";

export function ReceiptOrderItems({ items }: { items?: ProductSelectionQuoteResponse[] }) {
  const title = useId();
  return (
    <section className="receipt-order-items" aria-labelledby={title}>
      <h2 id={title}>Order items</h2>
      {items ? (
        <ol>
          {items.map((item, index) => (
            <li key={index}>
              <h3>{item.quantity} × {item.productName}</h3>
              {!!item.variants.length && (
                <div>
                  <h4>Variants</h4>
                  <ul>{item.variants.map((variant) => <li key={variant.id}>{variant.name}</li>)}</ul>
                </div>
              )}
              {!!item.addOns.length && (
                <div>
                  <h4>Add-ons</h4>
                  <ul>{item.addOns.map((addOn) => <li key={addOn.id}>{addOn.name}</li>)}</ul>
                </div>
              )}
              {!item.variants.length && !item.addOns.length && <p>No modifiers selected.</p>}
              {item.notes && <p className="receipt-item-note">Customer note: {item.notes}</p>}
              <p className="receipt-item-total">{`Line total: ${formatCartPrice(item.totalPrice)}`}</p>
            </li>
          ))}
        </ol>
      ) : <p className="order-receipt-note">Item details are unavailable in this saved receipt.</p>}
    </section>
  );
}
