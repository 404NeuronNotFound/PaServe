import { FiBarChart2 } from "react-icons/fi";
import { EmptyState } from "./EmptyState";
import { PendingButton } from "./PendingButton";

export function ReportEmptyState({
  title,
  description,
  label,
  pending,
  onRefresh,
  guidance = "Try another reporting period, or check again after paid orders are completed.",
}: {
  title: string;
  description: string;
  label: string;
  pending: boolean;
  onRefresh: () => void;
  guidance?: string;
}) {
  return (
    <EmptyState title={title} description={description} icon={<FiBarChart2 />}>
      <p className="empty-state-guidance">{guidance}</p>
      <PendingButton
        type="button"
        className="secondary-button"
        pending={pending}
        pendingLabel={`Checking ${label}…`}
        onClick={onRefresh}
      >
        Check for new {label}
      </PendingButton>
    </EmptyState>
  );
}
