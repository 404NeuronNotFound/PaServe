import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiCoffee, FiX, FiPlus, FiLoader } from "react-icons/fi";
import {
  PRODUCT_LIMITS,
  PRODUCT_PRICE_PATTERN,
  isValidProductImageUrl,
  type ProductStatus,
  type CreateProductRequest,
  type ProductsResponse,
  type CurrentUserResponse,
  type ApiErrorResponse,
  type MenuProduct,
  type UpdateProductRequest,
} from "@paserve/contracts";
import {
  categoriesKey,
  listCategories,
} from "../../features/shops/api/categories";
import {
  createProduct,
  updateProduct,
  productsKey,
} from "../../features/shops/api/products";
import { currentUserKey } from "../../features/auth/api/session";
import { feedback } from "../../app/stores/feedback";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { ProductImageUpload } from "./ProductImageUpload";
import { formatProductPrice } from "../../lib/money";

export function ProductEditor({
  userId,
  shopId,
  onClose,
  product,
}: {
  userId: string;
  shopId: string;
  onClose: () => void;
  product?: MenuProduct;
}) {
  const client = useQueryClient();
  const [imageSaved, setImageSaved] = useState(product?.imageUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState(product?.name ?? ""),
    [price, setPrice] = useState(product?.price ?? ""),
    [categoryId, setCategoryId] = useState(product?.categoryId ?? ""),
    [description, setDescription] = useState(product?.description ?? ""),
    [imageUrl, setImageUrl] = useState(product?.imageUrl ?? ""),
    [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));
  const [status, setStatus] = useState<ProductStatus>(
    product?.status ?? "AVAILABLE",
  );
  const [featured, setFeatured] = useState(product?.isFeatured ?? false),
    [discard, setDiscard] = useState(false),
    [closing, setClosing] = useState(false),
    [unavailable, setUnavailable] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    form = useRef<HTMLFormElement>(null),
    nameInput = useRef<HTMLInputElement>(null);
  const active = useRef(false),
    running = useRef(false),
    pendingFocus = useRef<string | null>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = product
    ? Boolean(
        name !== product.name ||
        price !== product.price ||
        categoryId !== (product.categoryId ?? "") ||
        description !== (product.description ?? "") ||
        imageUrl !== imageSaved ||
        featured !== product.isFeatured ||
        status !== product.status ||
        sortOrder !== String(product.sortOrder),
      )
    : Boolean(
        name ||
        price ||
        categoryId ||
        description ||
        imageUrl ||
        featured ||
        status !== "AVAILABLE" ||
        sortOrder !== "0",
      );
  const categories = useQuery({
    queryKey: categoriesKey(userId, shopId),
    queryFn: ({ signal }) => listCategories(shopId, signal),
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: (input: UpdateProductRequest) =>
      product
        ? updateProduct(shopId, product.id, input)
        : createProduct(shopId, input as CreateProductRequest),
    retry: false,
    networkMode: "always",
  });
  const disabled = mutation.isPending || uploading || closing || unavailable;
  function stillHere() {
    return (
      active.current &&
      client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
        userId
    );
  }
  useEffect(() => {
    active.current = true;
    const node = dialog.current;
    node?.showModal();
    nameInput.current?.focus();
    return () => {
      active.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      node?.close();
      queueMicrotask(() =>
        document
          .getElementById(
            product ? `edit-product-${product.id}` : "create-product-button",
          )
          ?.focus(),
      );
    };
  }, [product]);
  useEffect(() => {
    if (!dirty || closing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, closing]);
  function close() {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(
      onClose,
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    );
  }
  function requestClose() {
    if (running.current || uploading || closing || discard) return;
    if (dirty) setDiscard(true);
    else close();
  }
  function clearField(field: string) {
    setErrors((current) => ({ ...current, [field]: "" }));
    setError("");
  }
  function fieldError(field: string) {
    return errors[field] ? (
      <InlineMessage id={`product-${field}-error`} className="field-error">
        {errors[field]}
      </InlineMessage>
    ) : null;
  }
  useEffect(() => {
    if (disabled) return;
    const field = pendingFocus.current;
    if (!field) return;
    pendingFocus.current = null;
    const input = form.current?.elements.namedItem(field);
    if (!(input instanceof HTMLElement)) return;
    const options = input.closest("details");
    if (options) options.open = true;
    input.focus();
  }, [disabled, errors]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current || disabled || (product && !dirty)) return;
    const invalid: Record<string, string> = {};
    if (
      !name.trim() ||
      name.trim().length > PRODUCT_LIMITS.nameMax ||
      /\p{Cc}/u.test(name)
    )
      invalid.name =
        "Enter a product name, up to 120 characters, without control characters.";
    if (!PRODUCT_PRICE_PATTERN.test(price))
      invalid.price =
        "Use a price from 0 to 99999999.99 with up to two decimal places.";
    if (description.trim().length > PRODUCT_LIMITS.descriptionMax)
      invalid.description = "Use no more than 2000 characters.";
    if (
      imageUrl.trim() &&
      (!isValidProductImageUrl(imageUrl.trim()) ||
        imageUrl.trim().length > PRODUCT_LIMITS.imageUrlMax)
    )
      invalid.imageUrl = "Use an HTTPS image URL without credentials.";
    if (
      !/^\d+$/.test(sortOrder) ||
      Number(sortOrder) > PRODUCT_LIMITS.sortOrderMax
    )
      invalid.sortOrder = "Use a whole number from 0 to 2147483647.";
    if (
      categoryId &&
      categoryId !== product?.categoryId &&
      (!categories.isSuccess ||
        !categories.data.categories.some(
          (category) => category.id === categoryId,
        ))
    )
      invalid.categoryId = "Choose an available category or Uncategorized.";
    pendingFocus.current = Object.keys(invalid)[0] ?? null;
    setErrors(invalid);
    setError("");
    if (Object.keys(invalid).length) {
      return;
    }
    running.current = true;
    try {
      const values = {
        name: name.trim().replace(/\s+/g, " "),
        price,
        description: description.trim(),
        imageUrl: imageUrl.trim(),
        status,
        isFeatured: featured,
        sortOrder: Number(sortOrder),
      };
      const input: UpdateProductRequest = product
        ? {
            ...(values.name !== product.name ? { name: values.name } : {}),
            ...(values.price !== product.price ? { price: values.price } : {}),
            ...(categoryId !== (product.categoryId ?? "")
              ? { categoryId: categoryId || null }
              : {}),
            ...(values.description !== (product.description ?? "")
              ? { description: values.description }
              : {}),
            ...(values.imageUrl !== imageSaved
              ? { imageUrl: values.imageUrl }
              : {}),
            ...(values.status !== product.status
              ? { status: values.status }
              : {}),
            ...(values.isFeatured !== product.isFeatured
              ? { isFeatured: values.isFeatured }
              : {}),
            ...(values.sortOrder !== product.sortOrder
              ? { sortOrder: values.sortOrder }
              : {}),
          }
        : { ...values, ...(categoryId ? { categoryId } : {}) };
      if (!Object.keys(input).length) {
        close();
        return;
      }
      const result = await mutation.mutateAsync(input);
      if (!stillHere()) return;
      const key = productsKey(userId, shopId);
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return;
      client.setQueryData<ProductsResponse>(key, (current) => ({
        products: [
          ...(current?.products ?? []).filter(
            (product) => product.id !== result.product.id,
          ),
          result.product,
        ].sort(
          (a, b) =>
            a.sortOrder - b.sortOrder ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        ),
      }));
      void client.invalidateQueries({ queryKey: key });
      feedback.toast(
        `“${result.product.name}” was ${product ? "updated" : "created"}.`,
      );
      close();
    } catch (failure) {
      if (!stillHere()) return;
      if (isAxiosError<ApiErrorResponse>(failure)) {
        const code = failure.response?.status;
        if (code === 401 || code === 403) {
          setUnavailable(true);
          setError(
            "Your session or menu access changed. Sign in or choose another shop.",
          );
        } else if (code === 404) {
          setError(
            "The product, category or shop changed. Close this form and refresh products before retrying.",
          );
          void client.invalidateQueries({
            queryKey: categoriesKey(userId, shopId),
          });
        } else if (failure.response?.data?.fieldErrors) {
          const fields = Object.fromEntries(
            Object.entries(failure.response.data.fieldErrors).map(
              ([field, messages]) => [
                field,
                messages[0] ?? "Please check this field.",
              ],
            ),
          );
          pendingFocus.current = Object.keys(fields)[0] ?? null;
          setErrors(fields);
        } else if (!failure.response)
          setError(
            product
              ? "We couldn’t confirm the save. Close this form and refresh products before trying again."
              : "We couldn’t confirm creation. Close this form and refresh products before trying again.",
          );
        else
          setError(
            "We couldn’t save the product. Your draft is kept. Please try again.",
          );
      } else
        setError(
          "We couldn’t save the product. Your draft is kept. Please try again.",
        );
    } finally {
      running.current = false;
    }
  }
  const categoryHidden =
    categories.data?.categories.find((category) => category.id === categoryId)
      ?.isVisible === false;
  return (
    <>
      <dialog
        ref={dialog}
        className={`category-edit-dialog product-create-dialog${closing ? " is-closing" : ""}`}
        aria-modal="true"
        aria-labelledby="product-create-title"
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
        aria-busy={mutation.isPending || uploading}
      >
        <section className="category-editor">
          <header className="category-modal-heading">
            <span className="category-modal-icon">
              <FiCoffee aria-hidden="true" />
            </span>
            <div>
              <p className="section-label">SOMETHING WORTH SERVING</p>
              <h2 id="product-create-title">
                {product ? "Edit product" : "Create product"}
              </h2>
              <p>
                {product
                  ? "Keep your menu up to date."
                  : "Bring a new favorite to your menu."}
              </p>
            </div>
            <button
              type="button"
              className="secondary-button category-modal-close"
              aria-label="Close product form"
              disabled={mutation.isPending || uploading || closing}
              onClick={requestClose}
            >
              <FiX aria-hidden="true" />
            </button>
          </header>
          <form ref={form} noValidate onSubmit={(event) => void submit(event)}>
            <div className="field">
              <label htmlFor="product-name">Product name</label>
              <input
                ref={nameInput}
                id="product-name"
                name="name"
                autoComplete="off"
                required
                maxLength={PRODUCT_LIMITS.nameMax}
                value={name}
                disabled={disabled}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name ? "product-name-error" : undefined
                }
                onChange={(event) => {
                  setName(event.target.value);
                  clearField("name");
                }}
                placeholder="e.g. Iced latte"
              />
              {fieldError("name")}
            </div>
            <div className="product-form-grid">
              <div className="field">
                <label htmlFor="product-price">Price</label>
                <input
                  id="product-price"
                  name="price"
                  inputMode="decimal"
                  required
                  autoComplete="off"
                  value={price}
                  disabled={disabled}
                  aria-invalid={Boolean(errors.price)}
                  aria-describedby={`product-price-hint${errors.price ? " product-price-error" : ""}`}
                  placeholder="e.g. 120.00"
                  onChange={(event) => {
                    if (/^\d{0,8}(?:\.\d{0,2})?$/.test(event.target.value)) {
                      setPrice(event.target.value.replace(/^0+(?=\d)/, ""));
                      clearField("price");
                    }
                  }}
                />
                <p id="product-price-hint" className="field-hint">
                  PHP · Up to two decimal places. Zero is allowed.
                </p>
                {PRODUCT_PRICE_PATTERN.test(price) && (
                  <p className="field-hint" role="status">
                    Menu price: <strong>{formatProductPrice(price)}</strong>
                  </p>
                )}
                {fieldError("price")}
              </div>
              <div className="field">
                <label htmlFor="product-category">Category</label>
                <select
                  id="product-category"
                  name="categoryId"
                  value={categoryId}
                  disabled={disabled || categories.isPending}
                  aria-invalid={Boolean(errors.categoryId)}
                  aria-describedby={
                    errors.categoryId ? "product-categoryId-error" : undefined
                  }
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    clearField("categoryId");
                  }}
                >
                  <option value="">Uncategorized</option>
                  {product?.categoryId &&
                    !categories.data?.categories.some(
                      (item) => item.id === product.categoryId,
                    ) && (
                      <option value={product.categoryId}>
                        Current category (not loaded)
                      </option>
                    )}
                  {categories.data?.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                      {category.isVisible ? "" : " (hidden)"} · /{category.slug}
                    </option>
                  ))}
                </select>
                {fieldError("categoryId")}
              </div>
            </div>
            {categories.isPending && (
              <InlineMessage tone="info">Loading categories…</InlineMessage>
            )}
            {categories.isError && (
              <div>
                <InlineMessage>
                  {product
                    ? "Categories couldn’t be loaded. Keep the current category or choose Uncategorized."
                    : "Categories couldn’t be loaded. You can create in Uncategorized."}
                </InlineMessage>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={categories.isFetching || disabled}
                  onClick={() => void categories.refetch()}
                >
                  Refresh categories
                </button>
              </div>
            )}
            <div className="field">
              <label htmlFor="product-description">
                Description <span className="field-hint">(optional)</span>
              </label>
              <textarea
                id="product-description"
                name="description"
                rows={3}
                maxLength={PRODUCT_LIMITS.descriptionMax}
                value={description}
                disabled={disabled}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={`product-description-hint${errors.description ? " product-description-error" : ""}`}
                onChange={(event) => {
                  setDescription(event.target.value);
                  clearField("description");
                }}
                placeholder="A short description guests will love."
              />
              <p
                id="product-description-hint"
                className="field-hint category-character-count"
              >
                {description.length}/{PRODUCT_LIMITS.descriptionMax}
              </p>
              {fieldError("description")}
            </div>
            <div className="field">
              <label htmlFor="product-status">Menu status</label>
              <select
                id="product-status"
                name="status"
                value={status}
                disabled={disabled}
                onChange={(event) =>
                  setStatus(event.target.value as ProductStatus)
                }
              >
                <option value="AVAILABLE">Available</option>
                <option value="SOLD_OUT">Sold out</option>
                <option value="HIDDEN">Hidden</option>
              </select>
              <p className="field-hint">
                {categoryHidden
                  ? "This category is hidden, so its products won’t appear publicly."
                  : status === "HIDDEN"
                    ? "Kept in your workspace, hidden from the public menu."
                    : status === "SOLD_OUT"
                      ? "Shown on the menu as sold out."
                      : "Shown on the menu as available."}
              </p>
            </div>
            <details className="product-display-options">
              <summary>Image & display options</summary>
              <div>
                {product ? (
                  <ProductImageUpload
                    userId={userId}
                    shopId={shopId}
                    productId={product.id}
                    disabled={mutation.isPending || closing || unavailable}
                    onPending={setUploading}
                    onUploaded={(saved) => {
                      setImageUrl(saved.imageUrl ?? "");
                      setImageSaved(saved.imageUrl ?? "");
                      clearField("imageUrl");
                    }}
                  />
                ) : (
                  <p className="field-hint">
                    Create this product first, then open Edit to upload a photo.
                  </p>
                )}
                <div className="field">
                  <label htmlFor="product-image">
                    Image URL <span className="field-hint">(optional)</span>
                  </label>
                  <input
                    id="product-image"
                    name="imageUrl"
                    type="url"
                    maxLength={PRODUCT_LIMITS.imageUrlMax}
                    value={imageUrl}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.imageUrl)}
                    aria-describedby={`product-image-hint${errors.imageUrl ? " product-imageUrl-error" : ""}`}
                    onChange={(event) => {
                      setImageUrl(event.target.value);
                      clearField("imageUrl");
                    }}
                    placeholder="https://…"
                  />
                  <p id="product-image-hint" className="field-hint">
                    Use an existing HTTPS image address.
                  </p>
                  {fieldError("imageUrl")}
                </div>
                <label className="product-featured-field">
                  <input
                    name="isFeatured"
                    type="checkbox"
                    checked={featured}
                    disabled={disabled}
                    onChange={(event) => setFeatured(event.target.checked)}
                  />
                  <span>Feature this product</span>
                </label>
                <div className="field">
                  <label htmlFor="product-sort">Display order</label>
                  <input
                    id="product-sort"
                    name="sortOrder"
                    inputMode="numeric"
                    value={sortOrder}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.sortOrder)}
                    aria-describedby={`product-sort-hint${errors.sortOrder ? " product-sortOrder-error" : ""}`}
                    onChange={(event) => {
                      if (/^\d{0,10}$/.test(event.target.value)) {
                        setSortOrder(event.target.value);
                        clearField("sortOrder");
                      }
                    }}
                  />
                  <p id="product-sort-hint" className="field-hint">
                    Lower numbers appear first. Default: 0.
                  </p>
                  {fieldError("sortOrder")}
                </div>
              </div>
            </details>
            {error && <InlineMessage>{error}</InlineMessage>}
            {product && (
              <p className="field-hint">
                Menu address: <strong>/{product.slug}</strong>. Renaming keeps
                this address.
              </p>
            )}
            <footer className="category-modal-footer">
              <p className="field-hint" role="status">
                {mutation.isPending
                  ? product
                    ? "Saving changes…"
                    : "Creating product…"
                  : dirty
                    ? product
                      ? "Unsaved changes"
                      : "Unsaved product"
                    : product
                      ? "No changes yet"
                      : "Ready for a new favorite."}
              </p>
              <div className="category-editor-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={mutation.isPending || uploading || closing}
                  onClick={requestClose}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={disabled || Boolean(product && !dirty)}
                >
                  {mutation.isPending ? (
                    <FiLoader className="is-spinning" aria-hidden="true" />
                  ) : (
                    <FiPlus aria-hidden="true" />
                  )}
                  {mutation.isPending
                    ? product
                      ? "Saving…"
                      : "Creating…"
                    : product
                      ? "Save changes"
                      : "Create product"}
                </button>
              </div>
            </footer>
          </form>
        </section>
      </dialog>
      <DecisionDialog
        open={discard}
        title={product ? "Discard product changes?" : "Discard this product?"}
        description="Your unsaved product details will be lost."
        confirmLabel="Discard changes"
        cancelLabel={product ? "Keep editing" : "Keep creating"}
        onConfirm={close}
        onClose={() => setDiscard(false)}
      />
    </>
  );
}
