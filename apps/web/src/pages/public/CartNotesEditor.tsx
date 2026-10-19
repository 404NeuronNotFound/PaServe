import { useEffect, useId, useRef, useState } from "react";
import {
  CUSTOMER_NOTE_MAX_LENGTH,
  isValidCustomerNote,
  normalizeCustomerNote,
} from "@paserve/contracts";
import { FiEdit2 } from "react-icons/fi";
import { type CartItem, useCart } from "../../features/cart/cart";
import { CustomerNote } from "../../components/forms/CustomerNote";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";

export function CartNotesEditor({
  item,
  shopSlug,
  onEditingChange,
}: {
  item: CartItem;
  shopSlug: string;
  onEditingChange?: (id: string, editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [expected, setExpected] = useState(item);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const key = `${item.lineId}:notes`;
    onEditingChange?.(key, editing);
    return () => onEditingChange?.(key, false);
  }, [onEditingChange, item.lineId, editing]);
  const valid = isValidCustomerNote(draft);
  const changed =
    normalizeCustomerNote(draft) !==
    normalizeCustomerNote(expected.notes ?? "");
  useEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);

  function close() {
    setEditing(false);
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  }

  if (!editing)
    return (
      <div className="customer-cart-notes">
        {item.notes && (
          <div className="customer-cart-line-note">
            <span>Notes</span>
            <CustomerNote notes={item.notes} />
          </div>
        )}
        <button
          ref={trigger}
          className="secondary-button"
          type="button"
          aria-label={`${item.notes ? "Edit" : "Add"} notes for ${item.productName}`}
          onClick={() => {
            setExpected(item);
            setDraft(item.notes ?? "");
            setError("");
            setEditing(true);
          }}
        >
          <FiEdit2 aria-hidden="true" />{" "}
          {item.notes ? "Edit notes" : "Add notes"}
        </button>
      </div>
    );

  return (
    <form
      className="customer-cart-notes"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !changed) return;
        if (!useCart.getState().updateNotes(shopSlug, expected, draft)) {
          setError(
            "This cart item changed. Cancel and reopen its notes before trying again.",
          );
          return;
        }
        feedback.toast(
          normalizeCustomerNote(draft) ? "Notes saved." : "Notes removed.",
        );
        close();
      }}
    >
      <label htmlFor={id}>Notes for {item.productName} (optional)</label>
      <textarea
        ref={textarea}
        id={id}
        rows={3}
        maxLength={CUSTOMER_NOTE_MAX_LENGTH * 2}
        value={draft}
        aria-invalid={!valid}
        aria-describedby={`${id}-hint${!valid ? ` ${id}-invalid` : ""}${error ? ` ${id}-error` : ""}`}
        onChange={(event) => {
          setDraft(event.target.value);
          setError("");
        }}
      />
      <p id={`${id}-hint`} className="field-hint">
        Preparation requests · {[...draft].length}/{CUSTOMER_NOTE_MAX_LENGTH}
        {changed ? " · Unsaved notes" : ""}
      </p>
      {!valid && (
        <InlineMessage id={`${id}-invalid`} tone="error">
          Use plain text up to {CUSTOMER_NOTE_MAX_LENGTH} characters without
          unsupported control characters.
        </InlineMessage>
      )}
      {error && (
        <InlineMessage id={`${id}-error`} tone="error">
          {error}
        </InlineMessage>
      )}
      <div className="customer-cart-note-actions">
        <button
          className="secondary-button"
          type="submit"
          disabled={!valid || !changed}
        >
          Save notes
        </button>
        <button className="secondary-button" type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
