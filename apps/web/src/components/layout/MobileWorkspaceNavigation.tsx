import { useEffect, useRef, type ReactNode } from "react";
import { FiX } from "react-icons/fi";
import { Button } from "../ui/button";
import "./mobile-workspace-navigation.css";

export function MobileWorkspaceNavigation({
  open,
  onClose,
  shopName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  shopName: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog?.open) dialog?.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={dialogRef}
      id="mobile-workspace-navigation"
      className="mobile-workspace-navigation dashboard-sidebar-premium"
      aria-labelledby="mobile-workspace-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="mobile-workspace-heading">
        <div>
          <p className="section-label">YOUR WORKSPACE</p>
          <h2 id="mobile-workspace-title">Explore your shop</h2>
          <p>{shopName}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close navigation"
          onClick={onClose}
        >
          <FiX aria-hidden="true" />
        </Button>
      </header>
      <div className="mobile-workspace-links">{children}</div>
    </dialog>
  );
}
