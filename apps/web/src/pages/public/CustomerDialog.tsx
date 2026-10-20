import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PublicMenuResponse } from "@paserve/contracts";
import { menuTheme } from "../../lib/menu-theme";
import { FiX } from "react-icons/fi";

export function CustomerDialog({
  title,
  shop,
  onClose,
  pending = false,
  className = "",
  eyebrow,
  children,
}: {
  title: string;
  shop: PublicMenuResponse["shop"];
  onClose: () => void;
  pending?: boolean;
  className?: string;
  eyebrow?: string;
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
      className={`customer-dialog ${className}`}
      aria-labelledby={titleId}
      aria-modal="true"
      aria-busy={pending}
      style={menuTheme(shop.primaryColor, shop.accentColor)}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header className="customer-dialog-heading">
        <div>
          {eyebrow && <p className="customer-dialog-eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          aria-label="Close"
          title="Close"
          disabled={pending}
          onClick={onClose}
        >
          <FiX aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
