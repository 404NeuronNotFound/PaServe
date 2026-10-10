import { useEffect, useRef, useState } from "react";
import { FiArrowUp, FiArrowDown, FiLoader } from "react-icons/fi";
import type { MenuProduct } from "@paserve/contracts";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";

export function ProductOrderEditor({
  products,
  onSave,
  onClose,
  triggerId,
}: {
  products: MenuProduct[];
  onSave: (productIds: string[], expectedOrder: string[]) => Promise<boolean>;
  onClose: () => void;
  triggerId: string;
}) {
  const [original] = useState(() => products);
  const [draft, setDraft] = useState(() => products);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [discard, setDiscard] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const dirty = draft.some(
    (product, index) => product.id !== original[index].id,
  );
  useEffect(() => {
    mounted.current = true;
    const node = dialog.current;
    node?.showModal();
    title.current?.focus();
    return () => {
      mounted.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      node?.close();
      queueMicrotask(() => document.getElementById(triggerId)?.focus());
    };
  }, [triggerId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function finishClose() {
    if (closeTimer.current) return;
    setClosing(true);
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    closeTimer.current = setTimeout(onClose, reduced ? 0 : 180);
  }
  function move(index: number, direction: -1 | 1) {
    const next = [...draft];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    setDraft(next);
    setError("");
    setStatus(
      `${draft[index].name} moved to position ${index + direction + 1} of ${draft.length}.`,
    );
  }
  async function save() {
    if (saving.current || closing || !dirty) return;
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await onSave(
        draft.map((product) => product.id),
        original.map((product) => product.id),
      );
      if (saved && mounted.current) finishClose();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "We couldn’t save the order. Please try again.",
        );
    } finally {
      saving.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={`category-edit-dialog product-order-dialog${closing ? " is-closing" : ""}`}
      aria-labelledby="category-order-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending && !closing && !discard) {
          if (dirty) setDiscard(true);
          else finishClose();
        }
      }}
    >
      <section
        className="category-order-editor"
        aria-labelledby="category-order-title"
        aria-busy={pending}
      >
        <h3 id="category-order-title" ref={title} tabIndex={-1}>
          Reorder products
        </h3>
        <p>
          Move products into the order you want guests to see. Hidden products
          keep their place. Archived products are excluded.
        </p>
        <ol className="category-order-list">
          {draft.map((product, index) => (
            <li key={product.id}>
              <span className="category-order-position" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <strong>{product.name}</strong>
                <small>
                  /{product.slug} · {product.status}
                </small>
              </div>
              <div className="category-order-controls">
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`Move ${product.name} up`}
                  disabled={pending || closing || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <FiArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`Move ${product.name} down`}
                  disabled={pending || closing || index === draft.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <FiArrowDown aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <p role="status" className="categories-form-note">
          {pending
            ? "Saving product order…"
            : status ||
              (dirty
                ? "Order has unsaved changes."
                : "Move a product to change the order.")}
        </p>
        {error && <InlineMessage>{error}</InlineMessage>}
        <div className="category-editor-actions">
          <button
            type="button"
            className="primary-button"
            disabled={pending || closing || !dirty}
            onClick={() => void save()}
          >
            {pending && <FiLoader className="is-spinning" aria-hidden="true" />}
            {pending ? "Saving order…" : "Save order"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={pending || closing}
            onClick={() => (dirty ? setDiscard(true) : finishClose())}
          >
            Cancel
          </button>
        </div>
        <DecisionDialog
          open={discard}
          title="Discard this product order?"
          description="Your saved menu order will stay as it is. These unsaved moves will be lost."
          confirmLabel="Discard changes"
          cancelLabel="Keep arranging"
          onConfirm={finishClose}
          onClose={() => setDiscard(false)}
        />
      </section>
    </dialog>
  );
}
