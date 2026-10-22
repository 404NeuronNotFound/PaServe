import type { ComponentProps } from "react";
import { FiRefreshCw } from "react-icons/fi";
import { PendingButton } from "./PendingButton";
import "./refresh-button.css";

/** Products-page refresh treatment shared by every explicit refresh action. */
export function RefreshButton({
  label,
  pending = false,
  pendingLabel = "Refreshing",
  className = "",
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  label: string;
  pending?: boolean;
  pendingLabel?: string;
}) {
  return (
    <PendingButton
      {...props}
      type="button"
      pending={pending}
      pendingLabel={pendingLabel}
      iconOnly
      className={`secondary-button paserve-refresh-button ${className}`}
      aria-label={label}
      title={props.title ?? label}
    >
      <FiRefreshCw aria-hidden="true" />
    </PendingButton>
  );
}
