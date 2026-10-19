import type { ComponentProps } from "react";
import { FiLoader } from "react-icons/fi";
import "./pending-button.css";

/** Controlled pending UI; request handlers retain their own synchronous write guards. */
export function PendingButton({
  pending,
  pendingLabel,
  iconOnly = false,
  children,
  disabled,
  className = "",
  ...props
}: ComponentProps<"button"> & {
  pending: boolean;
  pendingLabel: string;
  iconOnly?: boolean;
}) {
  return (
    <button
      {...props}
      className={`pending-button ${className}`}
      disabled={disabled || pending}
      aria-busy={pending}
    >
      <span className="pending-button-content">
        <span
          className="pending-button-idle"
          aria-hidden={pending}
          data-visible={!pending}
        >
          {children}
        </span>
        <span
          className="pending-button-progress"
          aria-hidden={!pending}
          data-visible={pending}
        >
          <FiLoader aria-hidden="true" />
          <span className={iconOnly ? "sr-only" : undefined}>
            {pendingLabel}
          </span>
        </span>
      </span>
    </button>
  );
}
