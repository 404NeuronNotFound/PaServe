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
import { InlineMessage } from "../../components/feedback/InlineMessage";

export function CartQuantityControl({
  item,
  shopSlug,
}: {
  item: CartItem;
  shopSlug: string;
}) {
  const [draft, setDraft] = useState(String(item.quantity));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const count = Number(draft);
  const valid =
    /^\d+$/.test(draft) && Number.isInteger(count) && count >= 1 && count <= 99;

  async function update(quantity: number) {
    if (
      submitting.current || !Number.isInteger(quantity) ||
      quantity < 1 || quantity > 99
    ) return;
    if (quantity === item.quantity) {
      setDraft(String(quantity));
      setError("");
      return;
    }
    submitting.current = true;
    setDraft(String(quantity));
    setPending(true);
    setError("");
    const pricePreview = createCartPricePreview({ ...item, quantity });
    try {
      const response = await api.post<ProductSelectionQuoteResponse>(
        `/menu/${encodeURIComponent(shopSlug)}/products/${encodeURIComponent(item.productId)}/quote`,
        cartSelectionRequest(item, quantity),
      );
      if (!mounted.current) return;
      if (
        response.data.quantity !== quantity ||
        !useCart.getState().updateQuantity(shopSlug, item, response.data, pricePreview)
      ) {
        setError("This cart item changed. Close and reopen the cart before trying again.");
        return;
      }
      feedback.toast("Quantity updated.");
    } catch {
      if (mounted.current) {
        setError("We could not update this quantity. Your saved item is unchanged. Try again, or remove and add the item again if its options or availability changed.");
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
      <label htmlFor={id}>Quantity</label>
      <fieldset disabled={pending}>
        <legend className="sr-only">Quantity for {item.productName}</legend>
        <button
          type="button"
          className="secondary-button"
          aria-label={`Decrease quantity for ${item.productName}`}
          disabled={!valid || count <= 1}
          onClick={() => void update(count - 1)}
        >
          <FiMinus aria-hidden="true" />
        </button>
        <input
          ref={input}
          id={id}
          aria-label={`Quantity for ${item.productName}`}
          type="number"
          inputMode="numeric"
          min="1"
          max="99"
          step="1"
          value={draft}
          aria-invalid={!valid}
          aria-describedby={`${id}-hint${!valid ? ` ${id}-invalid` : ""}${error ? ` ${id}-error` : ""}`}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
        />
        <button
          type="button"
          className="secondary-button"
          aria-label={`Increase quantity for ${item.productName}`}
          disabled={!valid || count >= 99}
          onClick={() => void update(count + 1)}
        >
          <FiPlus aria-hidden="true" />
        </button>
        <button
          type="submit"
          className="secondary-button"
          aria-label={`Update quantity for ${item.productName}`}
          disabled={!valid || count === item.quantity}
        >
          {pending ? "Updating…" : "Update"}
        </button>
      </fieldset>
      <p id={`${id}-hint`} className="field-hint">1–99 per line. Use Remove to delete this item.</p>
      {!valid && (
        <InlineMessage id={`${id}-invalid`} tone="error">
          Choose a whole number from 1 to 99.
        </InlineMessage>
      )}
      {error && (
        <InlineMessage id={`${id}-error`} tone="error">{error}</InlineMessage>
      )}
      {pending && (
        <p className="field-hint" aria-live="polite">
          Checking current price and availability…
        </p>
      )}
    </form>
  );
}
