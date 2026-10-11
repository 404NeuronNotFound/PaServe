import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ADD_ON_LIMITS,
  CUSTOMER_NOTE_MAX_LENGTH,
  CUSTOMER_NOTE_PATTERN,
  normalizeCustomerNote,
  type PublicMenuResponse,
  type PublicProductDetailsResponse,
  type ProductSelectionQuoteResponse,
} from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { formatCartPrice, formatProductPrice } from "../../lib/money";
import { sumPrices, useCart } from "../../features/cart/cart";
import { feedback } from "../../app/stores/feedback";
import { CustomerDialog } from "./CustomerDialog";

export function ProductDetailsDialog({
  shop,
  product,
  preview,
  onClose,
}: {
  shop: PublicMenuResponse["shop"];
  product: PublicMenuResponse["products"][number];
  preview: boolean;
  onClose: () => void;
}) {
  const details = useQuery({
    queryKey: ["public-product", shop.slug, product.id],
    queryFn: async ({ signal }) =>
      (
        await api.get<PublicProductDetailsResponse>(
          `/menu/${encodeURIComponent(shop.slug)}/products/${encodeURIComponent(product.id)}`,
          { signal },
        )
      ).data,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  return (
    <CustomerDialog
      title={details.data?.product.name ?? product.name}
      shop={shop}
      onClose={onClose}
      pending={
        pendingVersion === details.dataUpdatedAt &&
        !details.isFetching &&
        !details.isError
      }
    >
      {details.isPending || details.isFetching ? (
        <p role="status">Loading product details…</p>
      ) : details.isError ? (
        <div className="customer-dialog-body">
          <p role="alert">
            This product could not be loaded. It may no longer be available.
          </p>
          <button
            className="secondary-button"
            onClick={() => void details.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <ProductDetailsForm
          key={details.dataUpdatedAt}
          data={details.data}
          shopSlug={shop.slug}
          preview={preview}
          onClose={onClose}
          onPending={(value) =>
            setPendingVersion(value ? details.dataUpdatedAt : null)
          }
          onRefresh={() => void details.refetch()}
        />
      )}
    </CustomerDialog>
  );
}

function ProductDetailsForm({
  data,
  shopSlug,
  preview,
  onClose,
  onPending,
  onRefresh,
}: {
  data: PublicProductDetailsResponse;
  shopSlug: string;
  preview: boolean;
  onClose: () => void;
  onPending: (value: boolean) => void;
  onRefresh: () => void;
}) {
  const { product, optionGroups, variants, addOns } = data;
  const isOrderable = product.status === "AVAILABLE" && product.isOrderable;
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      variants
        .filter((variant) => variant.isDefault)
        .map((variant) => [variant.optionGroupId ?? "ungrouped", variant.id]),
    ),
  );
  const [selectedAddOns, setAddOns] = useState<string[]>([]);
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [failedImage, setFailedImage] = useState(false);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const prefix = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const count = Number(quantity);
  const validQuantity =
    /^\d+$/.test(quantity) &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 99;
  const validNotes =
    notes.length <= CUSTOMER_NOTE_MAX_LENGTH &&
    CUSTOMER_NOTE_PATTERN.test(notes);
  const selectedVariants = variants.filter((variant) =>
    Object.values(choices).includes(variant.id),
  );
  const complete = optionGroups.every(
    (group) => !group.isRequired || Boolean(choices[group.id]),
  );
  const total = validQuantity
    ? sumPrices(
        [
          product.price,
          ...selectedVariants.map((variant) => variant.priceAdjustment),
          ...addOns
            .filter((option) => selectedAddOns.includes(option.id))
            .map((option) => option.priceAdjustment),
        ],
        count,
      )
    : undefined;
  const groups = [
    ...optionGroups,
    ...(variants.some((variant) => variant.optionGroupId === null)
      ? [{ id: "ungrouped", name: "Options", isRequired: false }]
      : []),
  ];
  async function addToCart() {
    if (
      submitting.current ||
      !validQuantity ||
      !validNotes ||
      !complete ||
      !isOrderable ||
      preview
    )
      return;
    submitting.current = true;
    setPending(true);
    onPending(true);
    setError("");
    try {
      const response = await api.post<ProductSelectionQuoteResponse>(
        `/menu/${encodeURIComponent(shopSlug)}/products/${encodeURIComponent(product.id)}/quote`,
        {
          variantIds: selectedVariants.map((variant) => variant.id),
          addOnIds: selectedAddOns,
          quantity: count,
          ...(normalizeCustomerNote(notes)
            ? { notes: normalizeCustomerNote(notes) }
            : {}),
        },
      );
      if (!mounted.current) return;
      useCart.getState().add(shopSlug, response.data);
      feedback.toast("Added to cart.");
      onClose();
    } catch {
      if (mounted.current)
        setError(
          "We could not add this item. Options, prices, or availability may have changed. Refresh details and try again.",
        );
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setPending(false);
        onPending(false);
      }
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void addToCart();
      }}
    >
      <div className="customer-dialog-body">
        {product.imageUrl && !failedImage && (
          <img
            className="product-details-image"
            src={product.imageUrl}
            alt={product.name}
            onError={() => setFailedImage(true)}
          />
        )}
        {product.description && (
          <p className="product-details-description">{product.description}</p>
        )}
        <p className="product-details-price">
          Base price <strong>{formatProductPrice(product.price)}</strong>
        </p>
        {!isOrderable && (
          <p role="status">
            Sold out — you can view this item, but it cannot be added to your
            cart.
          </p>
        )}
        <fieldset
          className="product-details-controls"
          disabled={pending || !isOrderable}
        >
          <legend className="sr-only">Customize your item</legend>
          {groups.map((group) => {
            const options = variants.filter(
              (variant) => (variant.optionGroupId ?? "ungrouped") === group.id,
            );
            return (
              <fieldset
                className="product-option-group"
                key={group.id}
                aria-describedby={`${prefix}-${group.id}-hint`}
              >
                <legend>
                  {group.name} {group.isRequired ? "(required)" : "(optional)"}
                </legend>
                <p id={`${prefix}-${group.id}-hint`} className="field-hint">
                  {!options.length
                    ? group.isRequired
                      ? "No choices are currently available. This item cannot be added until a choice is available."
                      : "No choices are currently available. You can skip this group."
                    : group.isRequired
                      ? "Choose one option."
                      : "Choose one option or leave this group unselected."}
                </p>
                {!group.isRequired && (
                  <label className="product-option">
                    <input
                      type="radio"
                      name={`${prefix}-${group.id}`}
                      checked={!choices[group.id]}
                      onChange={() =>
                        setChoices({ ...choices, [group.id]: "" })
                      }
                    />
                    No selection
                  </label>
                )}
                {options.map((option) => (
                  <label className="product-option" key={option.id}>
                    <input
                      type="radio"
                      name={`${prefix}-${group.id}`}
                      checked={choices[group.id] === option.id}
                      onChange={() =>
                        setChoices({ ...choices, [group.id]: option.id })
                      }
                      required={group.isRequired}
                    />
                    <span>{option.name}</span>
                    <strong>
                      +{formatProductPrice(option.priceAdjustment)}
                    </strong>
                  </label>
                ))}
              </fieldset>
            );
          })}
          {!!addOns.length && (
            <fieldset
              className="product-option-group"
              aria-describedby={`${prefix}-addons-hint`}
            >
              <legend>Add-ons (optional)</legend>
              <p id={`${prefix}-addons-hint`} className="field-hint">
                {addOns.length > ADD_ON_LIMITS.selectionMax
                  ? `Choose up to ${ADD_ON_LIMITS.selectionMax} extras. ${selectedAddOns.length} selected. Each applies once per item.`
                  : "Choose any extras. Each applies once per item."}
              </p>
              {addOns.map((option) => (
                <label className="product-option" key={option.id}>
                  <input
                    type="checkbox"
                    checked={selectedAddOns.includes(option.id)}
                    disabled={
                      !selectedAddOns.includes(option.id) &&
                      selectedAddOns.length >= ADD_ON_LIMITS.selectionMax
                    }
                    onChange={(event) =>
                      setAddOns(
                        event.target.checked
                          ? selectedAddOns.length < ADD_ON_LIMITS.selectionMax
                            ? [...selectedAddOns, option.id]
                            : selectedAddOns
                          : selectedAddOns.filter((id) => id !== option.id),
                      )
                    }
                  />
                  <span>{option.name}</span>{" "}
                  <strong>+{formatProductPrice(option.priceAdjustment)}</strong>
                </label>
              ))}
            </fieldset>
          )}
          {!groups.length && !addOns.length && (
            <p>No additional options for this item.</p>
          )}
          <label className="field" htmlFor={`${prefix}-quantity`}>
            Quantity
            <input
              id={`${prefix}-quantity`}
              type="number"
              inputMode="numeric"
              min="1"
              max="99"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              aria-invalid={!validQuantity}
              aria-describedby={
                !validQuantity ? `${prefix}-quantity-error` : undefined
              }
            />
          </label>
          {!validQuantity && (
            <p id={`${prefix}-quantity-error`} role="alert">
              Choose a quantity from 1 to 99.
            </p>
          )}
          <label className="field" htmlFor={`${prefix}-notes`}>
            Notes (optional)
            <textarea
              id={`${prefix}-notes`}
              rows={3}
              maxLength={CUSTOMER_NOTE_MAX_LENGTH}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-invalid={!validNotes}
              aria-describedby={`${prefix}-notes-hint`}
            />
          </label>
          <p id={`${prefix}-notes-hint`} className="field-hint">
            Preparation requests · {notes.length}/{CUSTOMER_NOTE_MAX_LENGTH}
          </p>
          {!validNotes && (
            <p role="alert">
              Use plain text without unsupported control characters.
            </p>
          )}
        </fieldset>
        {error && (
          <div>
            <p role="alert">{error}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={onRefresh}
            >
              Refresh details
            </button>
          </div>
        )}
        {preview && (
          <p className="field-hint">
            Preview only. Items are not added to a customer cart.
          </p>
        )}
      </div>
      <footer className="customer-dialog-footer">
        <p role="status">
          Estimated total{" "}
          <strong>{total ? formatCartPrice(total) : "—"}</strong>
        </p>
        <button
          className="primary-button"
          type="submit"
          disabled={
            pending ||
            preview ||
            !isOrderable ||
            !complete ||
            !validQuantity ||
            !validNotes
          }
        >
          {pending ? "Adding…" : "Add to cart"}
        </button>
      </footer>
    </form>
  );
}
