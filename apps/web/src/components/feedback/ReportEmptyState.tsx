import { RefreshButton } from "./RefreshButton";
import { FiBarChart2 } from "react-icons/fi";
import { EmptyState } from "./EmptyState";

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
      <RefreshButton label={`Check for new ${label}`}
        pending={pending}
        pendingLabel={`Checking ${label}…`}
        onClick={onRefresh}
      />
    </EmptyState>
  );
}
