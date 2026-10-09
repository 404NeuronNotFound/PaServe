import { useEffect, useRef, useState } from "react";
import { FiArrowUp, FiArrowDown, FiLoader } from "react-icons/fi";
import type { MenuCategory } from "@paserve/contracts";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";

export function CategoryOrderEditor({
  categories,
  onSave,
  onClose,
}: {
  categories: MenuCategory[];
  onSave: (categoryIds: string[], expectedOrder: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [original] = useState(() => categories);
  const [draft, setDraft] = useState(() => categories);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [discard, setDiscard] = useState(false);
  const mounted = useRef(false);
  const saving = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const dirty = draft.some(
    (category, index) => category.id !== original[index].id,
  );
  useEffect(() => {
    mounted.current = true;
    title.current?.focus();
    return () => {
      mounted.current = false;
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
    if (saving.current || !dirty) return;
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await onSave(
        draft.map((category) => category.id),
        original.map((category) => category.id),
      );
      if (saved && mounted.current) onClose();
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
    <section
      className="category-order-editor"
      aria-labelledby="category-order-title"
      aria-busy={pending}
    >
      <h3 id="category-order-title" ref={title} tabIndex={-1}>
        Reorder categories
      </h3>
      <p>
        Move categories into the order you want guests to see. Hidden categories
        keep their place for when you show them again.
      </p>
      <ol className="category-order-list">
        {draft.map((category, index) => (
          <li key={category.id}>
            <span className="category-order-position" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <strong>{category.name}</strong>
              <small>
                /{category.slug} · {category.isVisible ? "Visible" : "Hidden"}
              </small>
            </div>
            <div className="category-order-controls">
              <button
                type="button"
                className="secondary-button"
                aria-label={`Move ${category.name} up`}
                disabled={pending || index === 0}
                onClick={() => move(index, -1)}
              >
                <FiArrowUp aria-hidden="true" />
              </button>
              <button
                type="button"
                className="secondary-button"
                aria-label={`Move ${category.name} down`}
                disabled={pending || index === draft.length - 1}
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
          ? "Saving category order…"
          : status ||
            (dirty
              ? "Order has unsaved changes."
              : "Move a category to change the order.")}
      </p>
      {error && <InlineMessage>{error}</InlineMessage>}
      <div className="category-editor-actions">
        <button
          type="button"
          className="primary-button"
          disabled={pending || !dirty}
          onClick={() => void save()}
        >
          {pending && <FiLoader className="is-spinning" aria-hidden="true" />}
          {pending ? "Saving order…" : "Save order"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={() => (dirty ? setDiscard(true) : onClose())}
        >
          Cancel
        </button>
      </div>
      <DecisionDialog
        open={discard}
        title="Discard this category order?"
        description="Your saved menu order will stay as it is. These unsaved moves will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep arranging"
        onConfirm={onClose}
        onClose={() => setDiscard(false)}
      />
    </section>
  );
}
