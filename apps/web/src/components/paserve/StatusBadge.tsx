import type { ComponentProps } from "react";
import { Badge } from "../ui/badge";
const labels = {
  PENDING_CONFIRMATION: "Pending confirmation", CONFIRMED: "Confirmed", REJECTED: "Rejected",
  CANCELLED: "Cancelled", QUEUED: "Queued", PREPARING: "Preparing", READY: "Ready", COMPLETED: "Completed",
  AVAILABLE: "Available", SOLD_OUT: "Sold out", HIDDEN: "Hidden", ARCHIVED: "Archived",
};
export function StatusBadge({ state, children, ...props }: Omit<ComponentProps<typeof Badge>, "variant"> & { state: keyof typeof labels }) {
  return <Badge variant={state === "REJECTED" || state === "CANCELLED" ? "destructive" : "default"}
    data-state={state} {...props}>{children ?? labels[state]}</Badge>;
}
