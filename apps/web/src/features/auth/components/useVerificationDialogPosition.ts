import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/** Match the visible account column without coupling the modal to a grid ratio. */
export function useVerificationDialogPosition(
  open: boolean,
  formRef: RefObject<HTMLFormElement | null>,
) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const position = useRef<() => void>(() => {});
  const setDialogRef = useCallback((node: HTMLDivElement | null) => {
    dialogRef.current = node;
    position.current();
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const form = formRef.current;
    const panel = form?.closest(".form-panel");
    const viewport = window.visualViewport;
    const update = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const rect = form?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      // Small screens use the shared visual-viewport centering and keyboard fit.
      if (window.innerWidth <= 760 || !rect?.width || !panelRect?.width) {
        dialog.style.removeProperty("--verification-dialog-left");
        dialog.style.removeProperty("--verification-dialog-width");
        return;
      }
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const width = Math.min(480, panelRect.width - 32, window.innerWidth - 32);
      const center = Math.max(
        width / 2 + 16,
        Math.min(
          rect.left + rect.width / 2,
          window.innerWidth - width / 2 - 16,
        ),
      );
      dialog.style.setProperty("--verification-dialog-left", center + "px");
      dialog.style.setProperty("--verification-dialog-width", width + "px");
    };
    position.current = update;
    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    if (form) observer?.observe(form);
    if (panel) observer?.observe(panel);
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    return () => {
      position.current = () => {};
      observer?.disconnect();
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
    };
  }, [open, formRef]);
  return setDialogRef;
}
