import { useId, useState, type FormEvent } from "react";
import {
  normalizeOwnerOrderFilters,
  OWNER_ACTIVE_STATUS_FILTERS,
  OWNER_PAYMENT_METHOD_FILTERS,
  type OwnerOrderFilters,
  type OwnerOrderView,
} from "@paserve/contracts";
import { InlineMessage } from "../../components/feedback/InlineMessage";

const statusLabels = {
  PENDING_CONFIRMATION: "Pending confirmation",
  CONFIRMED: "Confirmed (any stage)",
  AWAITING_PAYMENT: "Awaiting payment",
  AWAITING_PREPARATION: "Awaiting preparation",
  QUEUED: "Queued",
  PREPARING: "Preparing",
  READY: "Ready",
  COMPLETED: "Fulfilled",
  REJECTED: "Rejected",
};
const paymentLabels = {
  CASH: "Cash",
  GCASH_MANUAL: "GCash (manual)",
  CARD_MANUAL: "Card (manual)",
  OTHER: "Other",
  UNRECORDED: "No payment recorded",
};
export function OrderFilters({
  view,
  filters,
  onApply,
}: {
  view: OwnerOrderView;
  filters: OwnerOrderFilters;
  onApply: (filters: OwnerOrderFilters) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<OwnerOrderFilters>(filters);
  const [error, setError] = useState("");
  function update(field: keyof OwnerOrderFilters, value: string) {
    setError("");
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === "mode" && value === "TAKEOUT" ? { table: "" } : {}),
    }));
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeOwnerOrderFilters(draft, view);
    if (!normalized) {
      setError(
        "Choose valid filters and a From date on or before the To date.",
      );
      return;
    }
    setError("");
    setDraft(normalized);
    onApply(normalized);
  }
  const count = Object.keys(filters).length;
  const summary = [
    filters.status ? statusLabels[filters.status] : "",
    filters.mode ? (filters.mode === "DINE_IN" ? "Dine-in" : "Takeout") : "",
    filters.paymentMethod ? paymentLabels[filters.paymentMethod] : "",
    filters.table ? `Table ${filters.table}` : "",
    filters.from ? `From ${filters.from}` : "",
    filters.to ? `To ${filters.to}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <details className="owner-order-filters">
      <summary>Filters{count ? ` (${count} active)` : ""}</summary>
      <form
        aria-label="Filter orders"
        onSubmit={apply}
        aria-describedby={`${id}-help`}
      >
        <div className="owner-order-filter-grid">
          {view === "active" ? (
            <label>
              Status
              <select
                value={draft.status ?? ""}
                onChange={(e) => update("status", e.target.value)}
              >
                <option value="">All active statuses</option>
                {OWNER_ACTIVE_STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="owner-order-fixed-filter">
              <span>Status</span>
              <p>{view === "completed" ? "Fulfilled" : "Rejected"}</p>
            </div>
          )}
          <label>
            Order type
            <select
              value={draft.mode ?? ""}
              onChange={(e) => update("mode", e.target.value)}
            >
              <option value="">All order types</option>
              <option value="DINE_IN">Dine-in</option>
              <option value="TAKEOUT">Takeout</option>
            </select>
          </label>
          {view !== "cancelled" ? (
            <label>
              Payment method
              <select
                value={draft.paymentMethod ?? ""}
                onChange={(e) => update("paymentMethod", e.target.value)}
              >
                <option value="">All payment methods</option>
                {OWNER_PAYMENT_METHOD_FILTERS.filter(
                  (method) => view === "active" || method !== "UNRECORDED",
                ).map((method) => (
                  <option key={method} value={method}>
                    {paymentLabels[method]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="owner-order-fixed-filter">
              <span>Payment</span>
              <p>Unpaid</p>
            </div>
          )}
          <label>
            From date
            <input
              type="date"
              min="1000-01-01"
              max="9998-12-31"
              value={draft.from ?? ""}
              onChange={(e) => update("from", e.target.value)}
            />
          </label>
          <label>
            To date
            <input
              type="date"
              min="1000-01-01"
              max="9998-12-31"
              value={draft.to ?? ""}
              onChange={(e) => update("to", e.target.value)}
            />
          </label>
          <label>
            Table label
            <input
              value={draft.table ?? ""}
              maxLength={40}
              disabled={draft.mode === "TAKEOUT"}
              placeholder="Any table"
              onChange={(e) => update("table", e.target.value)}
            />
          </label>
        </div>
        <p id={`${id}-help`}>
          Dates use {view === "completed" ? "completion" : "placement"} time in
          Manila. The To date includes the whole day. Table labels match the
          saved label exactly, ignoring case.
        </p>
        <div className="owner-order-filter-actions">
          <button className="secondary-button" type="submit">
            Apply filters
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setDraft({});
              setError("");
              onApply({});
            }}
          >
            Clear filters
          </button>
        </div>
        {error && <InlineMessage>{error}</InlineMessage>}
      </form>
      {summary && (
        <p className="owner-order-filter-summary">Applied: {summary}</p>
      )}
    </details>
  );
}
