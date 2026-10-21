import { FiCheckCircle, FiClock, FiCoffee, FiHelpCircle, FiMinusCircle, FiXCircle } from "react-icons/fi";

const waiting = { tone: "warning", Icon: FiClock } as const;
const progress = { tone: "info", Icon: FiCoffee } as const;
const success = { tone: "success", Icon: FiCheckCircle } as const;
const neutral = { tone: "neutral", Icon: FiMinusCircle } as const;
const danger = { tone: "danger", Icon: FiXCircle } as const;

export const statusPresentations = {
  PENDING_CONFIRMATION: { label: "Pending confirmation", ...waiting },
  CONFIRMED: { label: "Confirmed", ...success },
  REJECTED: { label: "Rejected", ...danger },
  CANCELLED: { label: "Cancelled", ...danger },
  FAILED: { label: "Failed", ...danger },
  UNPAID: { label: "Unpaid", ...waiting },
  PAID: { label: "Paid", ...success },
  NOT_STARTED: { label: "Not started", ...neutral },
  QUEUED: { label: "Queued", ...waiting },
  PREPARING: { label: "Preparing", ...progress },
  READY: { label: "Ready", ...success },
  COMPLETED: { label: "Completed", ...success },
  AVAILABLE: { label: "Available", ...success },
  VISIBLE: { label: "Visible", ...success },
  UNAVAILABLE: { label: "Unavailable", ...neutral },
  SOLD_OUT: { label: "Sold out", ...neutral },
  HIDDEN: { label: "Hidden", ...neutral },
  ARCHIVED: { label: "Archived", ...neutral },
  ENABLED: { label: "Enabled", ...success },
  DISABLED: { label: "Disabled", ...neutral },
  INACTIVE: { label: "Account inactive", ...neutral },
  PENDING: { label: "Pending", ...waiting },
  ACCEPTED: { label: "Accepted", ...success },
  EXPIRED: { label: "Expired", ...neutral },
  REVOKED: { label: "Revoked", ...neutral },
} as const;

export type VisualStatus = keyof typeof statusPresentations;

export function statusPresentation(state: string) {
  return Object.hasOwn(statusPresentations, state)
    ? statusPresentations[state as VisualStatus]
    : { label: "Unknown status", tone: "neutral", Icon: FiHelpCircle } as const;
}
