import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PublicMenuResponse } from "@paserve/contracts";
import { menuTheme } from "../../lib/menu-theme";

export function CustomerDialog({
  title,
  shop,
  onClose,
  pending = false,
  children,
}: {
  title: string;
  shop: PublicMenuResponse["shop"];
  onClose: () => void;
  pending?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node && !node.open) node.showModal();
    node?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      node?.close();
      queueMicrotask(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="customer-dialog"
      aria-labelledby={titleId}
      style={menuTheme(shop.primaryColor, shop.accentColor)}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header className="customer-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={onClose}
        >
          Close
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
