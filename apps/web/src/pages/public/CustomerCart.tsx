import { useState } from "react";
import { FiShoppingBag } from "react-icons/fi";
import type { PublicMenuResponse } from "@paserve/contracts";
import { EMPTY_CART, sumPrices, useCart } from "../../features/cart/cart";
import { formatCartPrice } from "../../lib/money";
import { CustomerNote } from "../../components/forms/CustomerNote";
import { CustomerDialog } from "./CustomerDialog";

export function CustomerCart({ shop }: { shop: PublicMenuResponse["shop"] }) {
  const items = useCart((state) => state.shops[shop.slug] ?? EMPTY_CART);
  const [open, setOpen] = useState(false);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <>
      <button
        type="button"
        className="customer-cart-button"
        aria-label={`View cart (${count})`}
        onClick={() => setOpen(true)}
      >
        <FiShoppingBag aria-hidden="true" />
        <span>View cart</span>
        <span className="customer-cart-count" aria-hidden="true">
          {count}
        </span>
        {!!count && (
          <strong aria-hidden="true">
            {formatCartPrice(sumPrices(items.map((item) => item.totalPrice)))}
          </strong>
        )}
      </button>
      {open && (
        <CustomerDialog
          title={`${shop.name} cart`}
          shop={shop}
          onClose={() => setOpen(false)}
        >
          <div className="customer-dialog-body">
            {!items.length && <p>Your cart is empty.</p>}
            <ul className="customer-cart-items">
              {items.map((item) => (
                <li key={item.lineId}>
                  <h3>{item.productName}</h3>
                  <p>
                    {item.quantity} × {formatCartPrice(item.unitPrice)} ·{" "}
                    {formatCartPrice(item.totalPrice)}
                  </p>
                  {!!(item.variants.length + item.addOns.length) && (
                    <p>
                      {[...item.variants, ...item.addOns]
                        .map((option) => option.name)
                        .join(", ")}
                    </p>
                  )}
                  <CustomerNote notes={item.notes} />
                  <button
                    type="button"
                    className="secondary-button"
                    aria-label={`Remove ${item.productName}`}
                    onClick={() =>
                      useCart.getState().remove(shop.slug, item.lineId)
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <footer className="customer-dialog-footer">
            <p>
              Total{" "}
              <strong>
                {formatCartPrice(
                  sumPrices(items.map((item) => item.totalPrice)),
                )}
              </strong>
            </p>
          </footer>
        </CustomerDialog>
      )}
    </>
  );
}
