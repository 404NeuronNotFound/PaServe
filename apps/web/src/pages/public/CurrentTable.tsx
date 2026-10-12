import type { PublicTableContext } from "@paserve/contracts";
import { FiMapPin } from "react-icons/fi";
import "./current-table.css";

export function CurrentTable({
  table,
  shopName,
}: {
  table: PublicTableContext;
  shopName: string;
}) {
  return (
    <div className="current-table" role="status" aria-label="Current table">
      <FiMapPin aria-hidden="true" />
      <div>
        <strong>Ordering for Table {table.number}</strong>
        <span>Dine-in at {shopName}</span>
      </div>
    </div>
  );
}
