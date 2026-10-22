import { RefreshButton } from "../../components/feedback/RefreshButton";
import { Button } from "../../components/ui/button";
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
        <Button variant="outline" size="inherit" type="button" className="secondary-button" onClick={() => {
          onReset();
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".owner-order-search input")?.focus());
        }} disabled={pending}>
          {filtered ? "Clear search and filters" : "Back to first page"}
        </Button>
      ) : (
        <RefreshButton label="Refresh orders" pending={pending}
          pendingLabel="Refreshing orders…" onClick={onRefresh} />
      )}
    </div>
  );
}
