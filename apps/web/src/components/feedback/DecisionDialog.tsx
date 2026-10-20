import { useEffect, useId, useRef, useState } from "react";
import { InlineMessage } from "./InlineMessage";
import { FiTrash2 } from "react-icons/fi";
import { PendingButton } from "./PendingButton";
import { pendingActionLabel } from "./pending-action-label";

type DecisionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  errorMessage?: (error: unknown) => string;
  animateClose?: boolean;
};

export function DecisionDialog(props: DecisionDialogProps) {
  return props.open ? <OpenDecisionDialog {...props} /> : null;
}

function OpenDecisionDialog({
  title,
  description,
  confirmLabel,
  pendingLabel = pendingActionLabel(confirmLabel),
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onClose,
  errorMessage,
  animateClose = false,
}: DecisionDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const running = useRef(false);
  const active = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    active.current = true;
    const node = dialog.current;
    const previousFocus = document.activeElement;
    node?.showModal();
    cancel.current?.focus();
    return () => {
      active.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      node?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    if (error && !pending) errorSummary.current?.focus();
  }, [error, pending]);

  function finishClose() {
    if (!active.current || closeTimer.current) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!animateClose || reduced) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(onClose, 180);
  }

  async function confirm() {
    if (running.current || closing || closeTimer.current) return;
    running.current = true;
    setPending(true);
    setError("");
    try {
      await onConfirm();
      finishClose();
    } catch (failure) {
      if (!active.current) return;
      setError(
        errorMessage?.(failure) ??
          "The action could not be completed. Please try again.",
      );
    } finally {
      running.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={`feedback-dialog${closing ? " is-closing" : ""}`}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!running.current && !closing) finishClose();
      }}
    >
      {destructive && (
        <span className="feedback-dialog-icon" aria-hidden="true">
          <FiTrash2 />
        </span>
      )}
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error && <InlineMessage ref={errorSummary} tabIndex={-1}>{error}</InlineMessage>}
      <div className="feedback-dialog-actions">
        <button
          ref={cancel}
          className="secondary-button feedback-dialog-cancel"
          type="button"
          disabled={pending || closing}
          onClick={finishClose}
        >
          {cancelLabel}
        </button>
        <PendingButton
          className={`primary-button${destructive ? " feedback-destructive" : ""}`}
          pending={pending}
          pendingLabel={pendingLabel}
          type="button"
          disabled={pending || closing}
          onClick={() => {
            void confirm();
          }}
        >
          {confirmLabel}
        </PendingButton>
      </div>
    </dialog>
  );
}
