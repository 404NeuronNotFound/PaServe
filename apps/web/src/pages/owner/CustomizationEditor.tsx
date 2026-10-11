import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FiTrash2, FiX } from "react-icons/fi";
import {
  PRODUCT_PRICE_PATTERN,
  type AddOn,
  type ProductVariant,
  type ProductOptionGroup,
} from "@paserve/contracts";
import { SelectField } from "../../components/forms/SelectField";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { formatProductPrice } from "../../lib/money";

export type EditorValues = {
  name: string;
  priceAdjustment: string;
  optionGroupId: string | null;
  isDefault: boolean;
  isRequired: boolean;
  isAvailable: boolean;
  sortOrder: number;
};
export function CustomizationEditor({
  kind,
  record,
  groups = [],
  busy,
  blocked,
  error,
  onSave,
  onClose,
  onDelete,
  initialGroupId,
}: {
  kind: "variant" | "group" | "addon";
  record?: AddOn | ProductVariant | ProductOptionGroup;
  groups?: ProductOptionGroup[];
  busy: boolean;
  blocked: boolean;
  error: string;
  onSave: (values: EditorValues) => Promise<void>;
  onClose: () => void;
  onDelete?: () => Promise<void>;
  initialGroupId?: string | null;
}) {
  const initial = {
    name: record?.name ?? "",
    priceAdjustment:
      record && "priceAdjustment" in record ? record.priceAdjustment : "0.00",
    optionGroupId:
      record && "optionGroupId" in record
        ? record.optionGroupId
        : (initialGroupId ?? null),
    isDefault: record && "isDefault" in record ? record.isDefault : false,
    isRequired: record && "isRequired" in record ? record.isRequired : false,
    isAvailable: record?.isAvailable ?? true,
    sortOrder: String(record?.sortOrder ?? 0),
  };
  const [values, setValues] = useState(initial),
    [validation, setValidation] = useState(""),
    [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moreSettings, setMoreSettings] = useState(false);
  const orderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (validation.startsWith("List position")) orderInput.current?.focus();
  }, [validation, moreSettings]);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const dialog = useRef<HTMLDialogElement>(null),
    nameInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const label =
    kind === "variant"
      ? "option"
      : kind === "group"
        ? "option group"
        : "add-on";
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    node?.showModal();
    nameInput.current?.focus();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function close() {
    if (!busy) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked) return;
    const name = values.name.trim().replace(/\s+/g, " ");
    if (!name || [...name].length > 80 || /[\p{Cc}\p{Cs}]/u.test(name)) {
      setValidation(
        "Enter a name up to 80 characters without control characters.",
      );
      nameInput.current?.focus();
      return;
    }
    if (
      kind !== "group" &&
      !PRODUCT_PRICE_PATTERN.test(values.priceAdjustment)
    ) {
      setValidation(
        "Enter an extra charge from 0 to 99999999.99, using up to two decimal places.",
      );
      return;
    }
    if (
      !/^\d{1,7}$/.test(values.sortOrder) ||
      Number(values.sortOrder) > 1000000
    ) {
      setValidation("List position must be a whole number from 0 to 1000000.");
      setMoreSettings(true);
      return;
    }
    if (
      kind === "variant" &&
      values.isDefault &&
      Number(values.priceAdjustment) !== 0
    ) {
      setValidation("The default option must have an extra charge of 0.");
      return;
    }
    setValidation("");
    await onSave({ ...values, name, sortOrder: Number(values.sortOrder) });
  }
  return (
    <>
      <dialog
        ref={dialog}
        className="customization-dialog"
        aria-labelledby={`${id}-title`}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <form onSubmit={(event) => void submit(event)}>
          <header>
            <div>
              <p className="section-label">MENU CUSTOMIZATION</p>
              <h2 id={`${id}-title`}>
                {record ? "Edit" : "Create"} {label}
              </h2>
            </div>
            <button
              type="button"
              className="secondary-button"
              aria-label="Close editor"
              disabled={busy}
              onClick={close}
            >
              <FiX aria-hidden="true" />
            </button>
          </header>
          {kind === "group" && !record && (
            <p className="field-hint">
              Name the group, such as Size. Next, add its options.
            </p>
          )}
          {kind === "addon" && record && (
            <p className="customization-notice">
              This is shared across your shop. Name, price and availability
              changes affect every product using this add-on.
            </p>
          )}
          <div className="field">
            <label htmlFor={`${id}-name`}>Name</label>
            <input
              id={`${id}-name`}
              ref={nameInput}
              value={values.name}
              placeholder={
                kind === "group"
                  ? "e.g. Size or Temperature"
                  : kind === "variant"
                    ? "e.g. Regular, Large or Iced"
                    : "e.g. Extra Shot or No Onions"
              }
              disabled={busy}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
              required
            />
            <span className="field-hint">
              {[...values.name].length}/80 characters
            </span>
          </div>
          {kind === "variant" && (
            <SelectField
              id={`${id}-group`}
              label="Option group"
              value={values.optionGroupId ?? ""}
              disabled={busy}
              options={[
                { value: "", label: "No group (standalone options)" },
                ...groups.map((group) => ({
                  value: group.id,
                  label: `${group.name}${group.isAvailable ? "" : " (disabled)"}`,
                })),
              ]}
              onChange={(value) =>
                setValues({ ...values, optionGroupId: value || null })
              }
            />
          )}
          {kind !== "group" && (
            <div className="field">
              <label htmlFor={`${id}-price`}>Extra charge (PHP)</label>
              <input
                id={`${id}-price`}
                inputMode="decimal"
                aria-describedby={`${id}-price-help`}
                value={values.priceAdjustment}
                disabled={busy || (kind === "variant" && values.isDefault)}
                onChange={(e) =>
                  setValues({ ...values, priceAdjustment: e.target.value })
                }
                required
              />
              <span className="field-hint" id={`${id}-price-help`}>
                Added to the product price. Enter 0 for no extra charge. Current
                charge:{" "}
                {PRODUCT_PRICE_PATTERN.test(values.priceAdjustment)
                  ? Number(values.priceAdjustment) === 0
                    ? "No extra charge"
                    : `+${formatProductPrice(values.priceAdjustment)}`
                  : "Use an exact amount, such as 15.50."}
              </span>
            </div>
          )}
          {kind === "variant" && (
            <label className="customization-check">
              <input
                type="checkbox"
                checked={values.isDefault}
                disabled={busy}
                onChange={(e) =>
                  setValues({
                    ...values,
                    isDefault: e.target.checked,
                    ...(e.target.checked ? { priceAdjustment: "0.00" } : {}),
                  })
                }
              />
              Use as the default option
            </label>
          )}
          {kind === "variant" && (
            <p className="field-hint">
              No extra charge. One default per group; clear the current default
              before choosing another.
            </p>
          )}
          {kind === "group" && (
            <label className="customization-check">
              <input
                type="checkbox"
                checked={values.isRequired}
                disabled={busy}
                onChange={(e) =>
                  setValues({ ...values, isRequired: e.target.checked })
                }
              />
              Customer must choose an option
            </label>
          )}
          <details
            className="customization-more"
            open={moreSettings}
            onToggle={(event) => setMoreSettings(event.currentTarget.open)}
          >
            <summary>More settings</summary>
            <label className="customization-check">
              <input
                type="checkbox"
                checked={values.isAvailable}
                disabled={busy}
                onChange={(e) =>
                  setValues({ ...values, isAvailable: e.target.checked })
                }
              />
              Available to customers
            </label>
            <p className="field-hint">
              {kind === "addon"
                ? "Turn off to hide this add-on on every product that offers it. Creating an add-on does not automatically add it to a product."
                : kind === "group"
                  ? "Turn off to hide this group and its options from customers."
                  : "Turn off to hide this option from customers."}
            </p>
            <div className="field">
              <label htmlFor={`${id}-order`}>List position</label>
              <input
                ref={orderInput}
                id={`${id}-order`}
                inputMode="numeric"
                aria-describedby={`${id}-order-help`}
                value={values.sortOrder}
                disabled={busy}
                onChange={(e) =>
                  setValues({ ...values, sortOrder: e.target.value })
                }
              />
              <span className="field-hint" id={`${id}-order-help`}>
                Lower numbers appear first. For example: Regular 0, Medium 1,
                Large 2. This changes the order customers see, not the price.
              </span>
            </div>
          </details>
          {(validation || error) && (
            <InlineMessage>{validation || error}</InlineMessage>
          )}
          <footer>
            <div className="customization-footer-context">
              {kind !== "group" && record && onDelete && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || blocked}
                  onClick={() => setDeleting(true)}
                >
                  <FiTrash2 aria-hidden="true" />
                  Delete {label}
                </button>
              )}
              {(busy || dirty) && (
                <span className="field-hint" role="status">
                  {busy ? "Saving..." : dirty ? "Unsaved changes" : ""}
                </span>
              )}
            </div>
            <div className="customization-footer-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy || blocked || Boolean(record && !dirty)}
              >
                {busy
                  ? "Saving..."
                  : record
                    ? "Save changes"
                    : `Create ${label}`}
              </button>
            </div>
          </footer>
        </form>
      </dialog>
      <DecisionDialog
        open={deleting}
        title={`Delete ${record?.name ?? label}?`}
        description={
          kind === "addon"
            ? "This deletes the add-on from your shop and every product using it. To remove it from just one product, uncheck it on that product's Customize page instead. Deleting cannot be undone. Unsaved edits will be discarded."
            : "This removes the saved option from this product. Deleting cannot be undone. Any unsaved edits to this option will be discarded."
        }
        confirmLabel={`Delete ${label}`}
        cancelLabel={`Keep ${label}`}
        destructive
        onConfirm={async () => {
          await onDelete?.();
        }}
        onClose={() => setDeleting(false)}
      />
      <DecisionDialog
        open={discard}
        title="Discard customization changes?"
        description="Your unsaved changes will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={onClose}
        onClose={() => setDiscard(false)}
      />
    </>
  );
}
