import { PendingButton } from "../../components/feedback/PendingButton";
import "../../components/feedback/empty-state.css";

export function OrderEmptyActions({ filtered, paged, pending, onReset, onRefresh }: {
  filtered: boolean;
  paged: boolean;
  pending: boolean;
  onReset: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="empty-state-actions">
      {filtered || paged ? (
        <button type="button" className="secondary-button" onClick={() => {
          onReset();
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".owner-order-search input")?.focus());
        }} disabled={pending}>
          {filtered ? "Clear search and filters" : "Back to first page"}
        </button>
      ) : (
        <PendingButton type="button" className="secondary-button" pending={pending}
          pendingLabel="Refreshing orders…" onClick={onRefresh}>
          Refresh orders
        </PendingButton>
      )}
    </div>
  );
}
