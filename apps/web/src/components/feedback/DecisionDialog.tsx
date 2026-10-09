import { useEffect, useId, useRef, useState } from "react";
import { InlineMessage } from "./InlineMessage";

type DecisionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export function DecisionDialog(props: DecisionDialogProps) {
  return props.open ? <OpenDecisionDialog {...props} /> : null;
}

function OpenDecisionDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onClose,
}: DecisionDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement;
    node?.showModal();
    cancel.current?.focus();
    return () => {
      node?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  async function confirm() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch {
      setError("The action could not be completed. Please try again.");
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="feedback-dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!running.current) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error && <InlineMessage>{error}</InlineMessage>}
      <div className="feedback-dialog-actions">
        <button
          ref={cancel}
          className="feedback-action feedback-dialog-cancel"
          type="button"
          disabled={pending}
          onClick={onClose}
        >
          {cancelLabel}
        </button>
        <button
          className={`primary-button${destructive ? " feedback-destructive" : ""}`}
          type="button"
          disabled={pending}
          onClick={() => {
            void confirm();
          }}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
