import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { FiShield } from "react-icons/fi";
import { SkeletonBlock } from "../../../components/feedback/LoadingSkeleton";
import "./access-gate.css";
import {
  ACCESS_CHECK_EVENT,
  AccessVerifiedContext,
  useAccessVerified,
} from "../access-status";

/** Hide and lock, rather than unmount, a previously verified workspace. Never
 * mount children from a cached grant until this boundary has verified access. */
export function AccessGate({
  allowed,
  pending,
  fallback,
  label,
  children,
}: {
  allowed: boolean;
  pending: boolean;
  fallback: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const [admitted, setAdmitted] = useState(false);
  const parentVerified = useAccessVerified();
  const focused = useRef<HTMLElement | null>(null);
  if (allowed && !admitted) setAdmitted(true);
  if (!allowed && !admitted) return fallback;
  return (
    <>
      <div
        className="access-gate-content"
        hidden={!allowed}
        inert={!allowed}
        aria-hidden={!allowed || undefined}
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement;
          if (
            allowed &&
            parentVerified &&
            !target.closest(".access-recheck-dialog")
          )
            focused.current = target;
        }}
      >
        <AccessVerifiedContext.Provider value={parentVerified && allowed}>
          {children}
        </AccessVerifiedContext.Provider>
      </div>
      {!allowed && (
        <AccessLock pending={pending} label={label} focusedRef={focused}>
          {fallback}
        </AccessLock>
      )}
    </>
  );
}

function AccessLock({
  pending,
  label,
  focusedRef,
  children,
}: {
  pending: boolean;
  label: string;
  focusedRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useLayoutEffect(() => {
    const node = dialog.current!;
    const focused = focusedRef.current;
    node.showModal();
    window.dispatchEvent(new Event(ACCESS_CHECK_EVENT));
    return () => {
      node.close();
      queueMicrotask(() => {
        const restore = () => {
          if (
            !document.querySelector(".access-recheck-dialog[open]") &&
            focused?.isConnected &&
            !focused.closest("[hidden], [inert]") &&
            (document.activeElement === document.body ||
              document.activeElement === focused)
          ) {
            focused.focus({ preventScroll: true });
          }
        };
        if (
          !focused?.isConnected ||
          document.querySelector(".access-recheck-dialog[open]")
        )
          return;
        // An independent payment recovery read may still disable this input.
        // Restore once it is usable, without taking focus from another control.
        if (focused.matches(":disabled")) {
          const observer = new MutationObserver(() => {
            if (!focused.isConnected || !focused.matches(":disabled")) {
              observer.disconnect();
              clearTimeout(timer);
              restore();
            }
          });
          const timer = setTimeout(() => observer.disconnect(), 15_000);
          observer.observe(focused, {
            attributes: true,
            attributeFilter: ["disabled"],
          });
        } else restore();
      });
    };
  }, [focusedRef]);
  return createPortal(
    <dialog
      ref={dialog}
      className="access-recheck-dialog"
      aria-modal="true"
      aria-labelledby={title}
      onCancel={(event) => event.preventDefault()}
    >
      <h2 className="sr-only" id={title}>
        {label}
      </h2>
      {pending ? (
        <div className="access-recheck-card" role="status" aria-label={label}>
          <FiShield aria-hidden="true" />
          <span className="sr-only">{label}</span>
          <div aria-hidden="true">
            <SkeletonBlock width={160} height={20} />
            <SkeletonBlock width={220} />
          </div>
        </div>
      ) : (
        children
      )}
    </dialog>,
    document.body,
  );
}
