import { useEffect, useRef, useState } from "react";
import { FiArrowRight, FiShoppingBag, FiTrash2 } from "react-icons/fi";
import type { PublicMenuResponse } from "@paserve/contracts";
import { cartItemsForShop, sumPrices, useCart } from "../../features/cart/cart";
import { formatCartPrice } from "../../lib/money";
import { CustomerNote } from "../../components/forms/CustomerNote";
import { CustomerDialog } from "./CustomerDialog";
import { CartQuantityControl } from "./CartQuantityControl";
import "./customer-cart.css";

export function CustomerCart({ shop }: { shop: PublicMenuResponse["shop"] }) {
  const items = useCart((state) => cartItemsForShop(state.shops, shop.slug));
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const removedIndex = useRef<number | null>(null);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  useEffect(() => {
    if (removedIndex.current === null) return;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>("[data-cart-remove]");
    const target =
      buttons?.[Math.min(removedIndex.current, (buttons?.length ?? 0) - 1)] ??
      browse.current;
    removedIndex.current = null;
    target?.focus();
  }, [items]);
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
          className="customer-cart-dialog"
          eyebrow="Your picks"
          onClose={() => setOpen(false)}
        >
          <div className="customer-dialog-body">
            {!items.length ? (
              <div className="customer-cart-empty">
                <span className="customer-cart-empty-icon" aria-hidden="true">
                  <FiShoppingBag />
                </span>
                <h3>Your cart is empty.</h3>
                <p>Find a favorite on the menu and make it yours.</p>
                <button
                  ref={browse}
                  className="primary-button"
                  type="button"
                  onClick={() => setOpen(false)}
                >
                  Browse menu <FiArrowRight aria-hidden="true" />
                </button>
              </div>
            ) : (
              <p className="customer-cart-intro">
                {count} {count === 1 ? "item" : "items"} from {shop.name}
              </p>
            )}
            <ul ref={list} className="customer-cart-items">
              {items.map((item, index) => (
                <li key={item.lineId}>
                  <div className="customer-cart-line-heading">
                    <h3>{item.productName}</h3>
                    <strong className="customer-cart-line-total">
                      {formatCartPrice(item.totalPrice)}
                    </strong>
                  </div>
                  <p className="customer-cart-line-quantity">
                    {item.quantity} × {formatCartPrice(item.unitPrice)}
                  </p>
                  {!!(item.variants.length + item.addOns.length) && (
                    <p className="customer-cart-line-choices">
                      {[...item.variants, ...item.addOns]
                        .map((option) => option.name)
                        .join(", ")}
                    </p>
                  )}
                  {item.notes && (
                    <div className="customer-cart-line-note">
                      <span>Notes</span>
                      <CustomerNote notes={item.notes} />
                    </div>
                  )}
                  <button
                    type="button"
                    data-cart-remove
                    className="secondary-button"
                    aria-label={`Remove ${item.productName}`}
                    onClick={() => {
                      removedIndex.current = index;
                      useCart.getState().remove(shop.slug, item.lineId);
                    }}
                  >
                    <FiTrash2 aria-hidden="true" /> Remove
                  </button>
                  <CartQuantityControl
                    item={item}
                    shopSlug={shop.slug}
                  />
                </li>
              ))}
            </ul>
          </div>
          <footer className="customer-dialog-footer">
            <p role="status" className="customer-cart-total">
              <span>Total</span>{" "}
              <strong>
                {formatCartPrice(
                  sumPrices(items.map((item) => item.totalPrice)),
                )}
              </strong>
            </p>
            {!!items.length && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpen(false)}
              >
                Continue shopping <FiArrowRight aria-hidden="true" />
              </button>
            )}
          </footer>
        </CustomerDialog>
      )}
    </>
  );
}
