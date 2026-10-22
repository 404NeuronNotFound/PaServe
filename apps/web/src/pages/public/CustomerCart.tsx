import { ConfirmDialog } from "../../components/paserve/ConfirmDialog";
import { createPortal } from "react-dom";
import { menuTheme } from "../../lib/menu-theme";
import { Button } from "../../components/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowRight, FiShoppingBag, FiTrash2 } from "react-icons/fi";
import type {
  PublicMenuResponse,
  CustomerOrderResponse,
  PublicTableContext,
} from "@paserve/contracts";
import {
  cartItemsForShop,
  cartItemCount,
  cartEstimatedSubtotal,
  PRICE_PREVIEW_NOTICE,
  useCart,
  type CartItem,
} from "../../features/cart/cart";
import { formatCartPrice } from "../../lib/money";
import { CustomerDialog } from "./CustomerDialog";
import { CartQuantityControl } from "./CartQuantityControl";
import { CartNotesEditor } from "./CartNotesEditor";
import "./customer-cart.css";
import { CustomerOrder } from "./CustomerOrder";
import { CurrentTable } from "./CurrentTable";
import { CartReview, type CartReviewSnapshot } from "./CartReview";
import { useChangeMotion } from "../../components/feedback/useChangeMotion";
import { CartItemConfiguration } from "./CartItemConfiguration";

export function CustomerCart({
  shop,
  table,
  onOrderPlaced,
}: {
  shop: PublicMenuResponse["shop"];
  table?: PublicTableContext;
  onOrderPlaced?: (order: CustomerOrderResponse["order"]) => void;
}) {
  const items = useCart((state) => cartItemsForShop(state.shops, shop.slug));
  const [open, setOpen] = useState(false);
  const [discardEdits, setDiscardEdits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [review, setReview] = useState<CartReviewSnapshot | null>(null);
  const [removed, setRemoved] = useState<{ item: CartItem; index: number }[]>([]);
  const onReviewChange = useCallback((next: CartReviewSnapshot | null) => {
    setReview(next);
    if (next) setRemoved([]);
  }, []);
  const onPendingChange = useCallback((pending: boolean) => {
    setSubmitting(pending);
    if (pending) setRemoved([]);
  }, []);
  const [edits, setEdits] = useState<Record<string, boolean>>({});
  const onEditingChange = useCallback((id: string, editing: boolean) => {
    setEdits((previous) =>
      previous[id] === editing ? previous : { ...previous, [id]: editing },
    );
  }, []);
  function closeCart() {
    if (submitting) return;
    if (Object.values(edits).some(Boolean)) { setDiscardEdits(true); return; }
    setReview(null); setRemoved([]); setOpen(false);
  }
  const [mode, setMode] = useState<"DINE_IN" | "TAKEOUT">(
    table ? "DINE_IN" : "TAKEOUT",
  );
  const list = useRef<HTMLUListElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const removedIndex = useRef<number | null>(null);
  const count = cartItemCount(items);
  const countMotion = useChangeMotion<HTMLSpanElement>(count, "count");
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
      <Button variant="ghost" size="inherit"
        type="button"
        className="customer-cart-button"
        aria-label={`View cart (${count})`}
        onClick={() => setOpen(true)}
      >
        <FiShoppingBag aria-hidden="true" />
        <span>View cart</span>
        {table && (
          <span className="customer-cart-table">Table {table.number}</span>
        )}
        <span ref={countMotion} className="customer-cart-count" aria-hidden="true">
          {count}
        </span>
        {!!count && (
          <strong aria-hidden="true" title="Estimated subtotal">
            {formatCartPrice(subtotal)}
          </strong>
        )}
      </Button>
      {!!count && createPortal(
        <div className="customer-cart-dock" style={menuTheme(shop.primaryColor, shop.accentColor)}>
          <Button variant="default" type="button" className="customer-cart-dock-button"
            onClick={() => setOpen(true)} aria-label={`View order, ${count} ${count === 1 ? "item" : "items"}, estimated subtotal ${formatCartPrice(subtotal)}`}>
            <span className="customer-cart-dock-count" aria-hidden="true">{count}</span>
            <span>View order <small>Estimated subtotal</small></span>
            <strong>{formatCartPrice(subtotal)}</strong>
            <FiArrowRight aria-hidden="true" />
          </Button>
        </div>, document.body,
      )}
      {open && (
        <CustomerDialog
          title={`${shop.name} ${review ? "order review" : "cart"}`}
          shop={shop}
          className="customer-cart-dialog"
          eyebrow={review ? "Review & place" : "Your picks"}
          pending={submitting}
          onClose={closeCart}
        >
          <ol className="customer-checkout-steps" aria-label="Checkout progress">
            <li aria-current={!review ? "step" : undefined}>1. Cart</li>
            <li aria-current={review ? "step" : undefined}>2. Review</li>
          </ol>
          <div className="customer-dialog-body">
            {review ? (
              <CartReview review={review} />
            ) : (
              <>
                {table && (
                  <CurrentTable
                    table={table}
                    shopName={shop.name}
                    ordering={mode === "DINE_IN"}
                  />
                )}
                {!items.length ? (
                  <div className="customer-cart-empty">
                    <span
                      className="customer-cart-empty-icon"
                      aria-hidden="true"
                    >
                      <FiShoppingBag />
                    </span>
                    <h3>Your cart is empty.</h3>
                    <p>Find a favorite on the menu and make it yours.</p>
                    <Button variant="default" size="inherit"
                      ref={browse}
                      className="primary-button"
                      type="button"
                      onClick={closeCart}
                    >
                      Browse menu <FiArrowRight aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <p className="customer-cart-intro">
                    {count} {count === 1 ? "item" : "items"} from {shop.name}
                  </p>
                )}
                <ul ref={list} className="customer-cart-items" aria-label="Cart items">
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
                      <CartItemConfiguration item={item} groupClassName="customer-cart-line-choices" />
                      <div className="customer-cart-line-actions">
                        <CartQuantityControl
                          item={item}
                          shopSlug={shop.slug}
                          onEditingChange={onEditingChange}
                        />
                        <CartNotesEditor
                          item={item}
                          shopSlug={shop.slug}
                          onEditingChange={onEditingChange}
                        />
                        <Button variant="outline" size="inherit"
                          type="button"
                          data-cart-remove
                          disabled={Object.values(edits).some(Boolean)}
                          className="secondary-button customer-cart-remove"
                          aria-label={`Remove ${item.productName}`}
                          title={`Remove ${item.productName}`}
                          onClick={() => {
                            removedIndex.current = index;
                            setRemoved((previous) => [...previous, { item, index }]);
                            useCart.getState().remove(shop.slug, item.lineId);
                          }}
                        >
                          <FiTrash2 aria-hidden="true" />
                          <span>Remove</span>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <footer className="customer-dialog-footer">
            {!review && removed.length > 0 && (
              <div className="customer-cart-undo" role="status">
                <span>Removed {removed[removed.length - 1].item.productName}.</span>
                <Button variant="outline" disabled={submitting} onClick={() => {
                  if (review || submitting) return;
                  const last = removed[removed.length - 1];
                  if (useCart.getState().restoreRemoved(shop.slug, last.item, last.index)) {
                    removedIndex.current = last.index;
                  }
                  setRemoved((previous) => previous.slice(0, -1));
                }} aria-label={`Undo removal of ${removed[removed.length - 1].item.productName}`}>Undo</Button>
              </div>
            )}
            <div className="customer-cart-summary">
              <p role="status" aria-label="Cart total" className="customer-cart-total">
                <span>{review ? "Total to confirm" : "Estimated subtotal"}</span>
                <strong>{formatCartPrice(review ? cartEstimatedSubtotal(review.items) : subtotal)}</strong>
              </p>
              <p className="field-hint customer-cart-price-notice">
                {review ? "We check this total before saving. Price changes require another review. The cashier will confirm your order and collect payment." : PRICE_PREVIEW_NOTICE}
              </p>
            </div>
            <CustomerOrder
              key={shop.slug}
              shopSlug={shop.slug}
              table={table}
              initialMode={mode}
              onModeChange={setMode}
              onReviewChange={onReviewChange}
              onPendingChange={onPendingChange}
              editing={Object.values(edits).some(Boolean)}
              onOrderPlaced={onOrderPlaced}
            />
            {!review && (
              <>
                {!!items.length && (
                  <Button variant="outline" size="inherit"
                    type="button"
                    className="secondary-button customer-cart-continue"
                    onClick={closeCart}
                  >
                    Continue shopping <FiArrowRight aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
          </footer>
        </CustomerDialog>
      )}
      <ConfirmDialog open={discardEdits} title="Discard unsaved cart edits?"
        description="Unsaved quantity or note edits will be discarded. Your saved cart items will remain."
        confirmLabel="Discard edits" cancelLabel="Keep editing" destructive
        onConfirm={() => { setReview(null); setRemoved([]); setOpen(false); }} onClose={() => setDiscardEdits(false)} />
    </>
  );
}
