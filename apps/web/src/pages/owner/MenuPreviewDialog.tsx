import { Button } from "../../components/ui/button";
import { useEffect, useRef } from "react";
import type { PublicMenuResponse } from "@paserve/contracts";
import { LiveMenuPreview } from "./LiveMenuPreview";

export function MenuPreviewDialog({
  draft,
  unsaved,
  onClose,
}: {
  draft: Partial<PublicMenuResponse["shop"]>;
  unsaved: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    close.current?.focus();
    return () => {
      node?.close();
      queueMicrotask(() =>
        document.getElementById("preview-settings-changes")?.focus(),
      );
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="menu-preview-dialog"
      aria-labelledby="preview-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="menu-preview-heading">
        <h2 id="preview-dialog-title">Preview changes</h2>
        <Button variant="outline" size="inherit"
          ref={close}
          type="button"
          className="secondary-button"
          onClick={onClose}
        >
          Back to editing
        </Button>
      </header>
      <LiveMenuPreview draft={draft} unsaved={unsaved} />
    </dialog>
  );
}
