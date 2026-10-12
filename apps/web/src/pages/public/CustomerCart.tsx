import { useEffect, useRef, useState } from "react";
import { FiArrowRight, FiShoppingBag, FiTrash2 } from "react-icons/fi";
import type {
  PublicMenuResponse,
  PublicTableContext,
} from "@paserve/contracts";
import {
  cartItemsForShop,
  cartItemCount,
  cartEstimatedSubtotal,
  PRICE_PREVIEW_NOTICE,
  useCart,
} from "../../features/cart/cart";
import { formatCartPrice } from "../../lib/money";
import { CustomerDialog } from "./CustomerDialog";
import { CartQuantityControl } from "./CartQuantityControl";
import { CartNotesEditor } from "./CartNotesEditor";
import "./customer-cart.css";
import { DineInOrder } from "./DineInOrder";
import { CurrentTable } from "./CurrentTable";

export function CustomerCart({
  shop,
  table,
}: {
  shop: PublicMenuResponse["shop"];
  table?: PublicTableContext;
}) {
  const items = useCart((state) => cartItemsForShop(state.shops, shop.slug));
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const removedIndex = useRef<number | null>(null);
  const count = cartItemCount(items);
  const subtotal = cartEstimatedSubtotal(items);
  useEffect(() => {
    if (removedIndex.current === null) return;
    const buttons =
      list.current?.querySelectorAll<HTMLButtonElement>("[data-cart-remove]");
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
        {table && <span className="customer-cart-table">Table {table.number}</span>}
        <span className="customer-cart-count" aria-hidden="true">
          {count}
        </span>
        {!!count && (
          <strong aria-hidden="true" title="Estimated subtotal">
            {formatCartPrice(subtotal)}
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
            {table && (
              <CurrentTable table={table} shopName={shop.name} />
            )}
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
                      <span className="sr-only">Estimated line total </span>
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
                  <div className="customer-cart-line-actions">
                    <CartQuantityControl item={item} shopSlug={shop.slug} />
                    <CartNotesEditor item={item} shopSlug={shop.slug} />
                    <button
                      type="button"
                      data-cart-remove
                      className="secondary-button customer-cart-remove"
                      aria-label={`Remove ${item.productName}`}
                      title={`Remove ${item.productName}`}
                      onClick={() => {
                        removedIndex.current = index;
                        useCart.getState().remove(shop.slug, item.lineId);
                      }}
                    >
                      <FiTrash2 aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <footer className="customer-dialog-footer">
            {table && <DineInOrder key={shop.slug} shopSlug={shop.slug} table={table} />}
            <div className="customer-cart-summary">
              <p role="status" className="customer-cart-total">
                <span>Estimated subtotal</span>{" "}
                <strong>{formatCartPrice(subtotal)}</strong>
              </p>
            </div>
            {!!items.length && (
              <button
                type="button"
                className="primary-button customer-cart-continue"
                onClick={() => setOpen(false)}
              >
                Continue shopping <FiArrowRight aria-hidden="true" />
              </button>
            )}
            <p className="field-hint customer-cart-price-notice">
              {PRICE_PREVIEW_NOTICE}
            </p>
          </footer>
        </CustomerDialog>
      )}
    </>
  );
}
