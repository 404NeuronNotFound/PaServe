import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { useDraftGuard } from "../../app/router/useDraftGuard";
import { ORDER_INPUT_LIMITS, isValidOrderQuantity } from "@paserve/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { FiMinus, FiPlus } from "react-icons/fi";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
import {
  createCartPricePreview,
  cartSelectionRequest,
  useCart,
  type CartItem,
} from "../../features/cart/cart";
import { api } from "../../lib/api/client";
import { feedback } from "../../app/stores/feedback";
import { formatCartPrice } from "../../lib/money";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { describeRequestFailure } from "../../components/feedback/request-failure";
import { PendingButton } from "../../components/feedback/PendingButton";

export function CartQuantityControl({
  item,
  shopSlug,
  onEditingChange,
}: {
  item: CartItem;
  shopSlug: string;
  onEditingChange?: (id: string, editing: boolean) => void;
}) {
  const [draft, setDraft] = useState(String(item.quantity));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retryQuantity, setRetryQuantity] = useState<number | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const key = `${item.lineId}:quantity`;
    onEditingChange?.(key, pending || draft !== String(item.quantity));
    return () => onEditingChange?.(key, false);
  }, [onEditingChange, item.lineId, item.quantity, pending, draft]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useDraftGuard(draft !== String(item.quantity), pending);
  const count = Number(draft);
  const valid = /^\d+$/.test(draft) && isValidOrderQuantity(count);
  const draftPreview =
    valid && count !== item.quantity
      ? createCartPricePreview({ ...item, quantity: count })
      : undefined;

  function restoreSavedQuantity() {
    const saved = useCart.getState().shops[shopSlug]?.find(
      (line) => line.lineId === item.lineId,
    );
    setDraft(String(saved?.quantity ?? item.quantity));
  }

  async function update(quantity: number, retry = false) {
    if (submitting.current || !isValidOrderQuantity(quantity)) return;
    if (quantity === item.quantity) {
      setDraft(String(quantity));
      setError("");
      setRetryQuantity(null);
      return;
    }
    submitting.current = true;
    setDraft(String(quantity));
    setPending(true);
    setError("");
    if (!retry) setRetryQuantity(null);
    const pricePreview = createCartPricePreview({ ...item, quantity });
    try {
      const response = await api.post<ProductSelectionQuoteResponse>(
        `/menu/${encodeURIComponent(shopSlug)}/products/${encodeURIComponent(item.productId)}/quote`,
        cartSelectionRequest(item, quantity),
      );
      if (!mounted.current) return;
      if (
        response.data.quantity !== quantity ||
        !useCart
          .getState()
          .updateQuantity(shopSlug, item, response.data, pricePreview)
      ) {
        restoreSavedQuantity();
        setRetryQuantity(null);
        setError(
          "This cart item changed. Close and reopen the cart before trying again.",
        );
        return;
      }
      setRetryQuantity(null);
      feedback.toast("Quantity updated.");
    } catch (failure) {
      if (mounted.current) {
        restoreSavedQuantity();
        const context = describeRequestFailure(failure, "this quantity and item availability", { product: true, publicView: true });
        setRetryQuantity(context.retryable ? quantity : null);
        setError(
          context.kind === "unknown"
            ? "We could not update this quantity. Your saved item is unchanged. Try again, or remove and add the item again if its options or availability changed."
            : `${context.message} Your saved item is unchanged.`,
        );
      }
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setPending(false);
        requestAnimationFrame(() => {
          if (mounted.current) input.current?.focus();
        });
      }
    }
  }

  return (
    <form
      className="customer-cart-quantity-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void update(count);
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Quantity
      </label>
      <fieldset disabled={pending}>
        <legend className="sr-only">Quantity for {item.productName}</legend>
        <div className="customer-cart-stepper">
          <Button variant="outline" size="inherit"
            type="button"
            className="secondary-button"
            aria-label={`Decrease quantity for ${item.productName}`}
            disabled={!valid || count <= 1}
            onClick={() => void update(count - 1)}
          >
            <FiMinus aria-hidden="true" />
          </Button>
          <Input
            ref={input}
            id={id}
            aria-label={`Quantity for ${item.productName}`}
            type="number"
            inputMode="numeric"
            min="1"
            max={ORDER_INPUT_LIMITS.quantityMax}
            step="1"
            value={draft}
            aria-invalid={!valid}
            aria-describedby={`${id}-hint${!valid ? ` ${id}-invalid` : ""}${error ? ` ${id}-error` : ""}`}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
              setRetryQuantity(null);
            }}
          />
          <Button variant="outline" size="inherit"
            type="button"
            className="secondary-button"
            aria-label={`Increase quantity for ${item.productName}`}
            disabled={!valid || count >= ORDER_INPUT_LIMITS.quantityMax}
            onClick={() => void update(count + 1)}
          >
            <FiPlus aria-hidden="true" />
          </Button>
        </div>
        {(pending || draft !== String(item.quantity)) && (
          <Button variant="default" size="inherit"
            type="submit"
            className="primary-button customer-cart-quantity-save"
            aria-label={`Update quantity for ${item.productName}`}
            disabled={!valid || count === item.quantity}
          >
            {pending ? "Updating…" : "Update"}
          </Button>
        )}
      </fieldset>
      <p id={`${id}-hint`} className="sr-only">
        1–99 per line. Use Remove to delete this item.
      </p>
      {draftPreview && (
        <p className="customer-cart-draft-preview" aria-live="polite">
          Estimated total for {count}:{" "}
          <strong>{formatCartPrice(draftPreview.totalPrice)}</strong>
          <span className="field-hint">
            Updates after price and availability are checked.
          </span>
        </p>
      )}
      {!valid && (
        <InlineMessage id={`${id}-invalid`} tone="error">
          Choose a whole number from 1 to 99.
        </InlineMessage>
      )}
      {error && (
        <InlineMessage id={`${id}-error`} tone="error">
          {error}
        </InlineMessage>
      )}
      {retryQuantity !== null && (
        <PendingButton type="button" className="secondary-button" pending={pending}
          pendingLabel="Checking quantity…" onClick={() => void update(retryQuantity, true)}>
          Retry quantity update
        </PendingButton>
      )}
      {pending && (
        <p className="field-hint" aria-live="polite">
          Checking current price and availability…
        </p>
      )}
    </form>
  );
}
