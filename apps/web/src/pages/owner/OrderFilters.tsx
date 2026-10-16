import { useId, useState, type FormEvent } from "react";
import {
  normalizeOwnerOrderFilters,
  OWNER_ACTIVE_STATUS_FILTERS,
  OWNER_PAYMENT_METHOD_FILTERS,
  TABLE_LIMITS,
  type OwnerOrderFilters,
  type OwnerOrderView,
} from "@paserve/contracts";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { FiSliders, FiChevronDown } from "react-icons/fi";
import { SelectField } from "../../components/forms/SelectField";

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
      <summary>
        <FiSliders aria-hidden="true" />
        Filters{count ? ` (${count} active)` : ""}
        <FiChevronDown aria-hidden="true" className="owner-filter-chevron" />
      </summary>
      <form
        aria-label="Filter orders"
        onSubmit={apply}
        aria-describedby={`${id}-help`}
      >
        <div className="owner-order-filter-grid">
          {view === "active" ? (
            <div className="owner-order-filter-field">
              <label htmlFor={`${id}-status`}>Status</label>
              <SelectField
                id={`${id}-status`}
                label="Status"
                value={draft.status ?? ""}
                onChange={(value) => update("status", value)}
                options={[
                  { value: "", label: "All active statuses" },
                  ...OWNER_ACTIVE_STATUS_FILTERS.map((status) => ({
                    value: status,
                    label: statusLabels[status],
                  })),
                ]}
              />
            </div>
          ) : (
            <div className="owner-order-fixed-filter">
              <span>Status</span>
              <p>{view === "completed" ? "Fulfilled" : "Rejected"}</p>
            </div>
          )}
          <div className="owner-order-filter-field">
            <label htmlFor={`${id}-mode`}>Order type</label>
            <SelectField
              id={`${id}-mode`}
              label="Order type"
              value={draft.mode ?? ""}
              onChange={(value) => update("mode", value)}
              options={[
                { value: "", label: "All order types" },
                { value: "DINE_IN", label: "Dine-in" },
                { value: "TAKEOUT", label: "Takeout" },
              ]}
            />
          </div>
          {view !== "cancelled" ? (
            <div className="owner-order-filter-field">
              <label htmlFor={`${id}-method`}>Payment method</label>
              <SelectField
                id={`${id}-method`}
                label="Payment method"
                value={draft.paymentMethod ?? ""}
                onChange={(value) => update("paymentMethod", value)}
                options={[
                  { value: "", label: "All payment methods" },
                  ...OWNER_PAYMENT_METHOD_FILTERS.filter(
                    (method) => view === "active" || method !== "UNRECORDED",
                  ).map((method) => ({
                    value: method,
                    label: paymentLabels[method],
                  })),
                ]}
              />
            </div>
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
              maxLength={TABLE_LIMITS.numberMaxLength * 2}
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
          <button className="primary-button" type="submit">
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
