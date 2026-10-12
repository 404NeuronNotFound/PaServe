import type { PublicTableContext } from "@paserve/contracts";
import { FiMapPin } from "react-icons/fi";
import "./current-table.css";

export function CurrentTable({
  table,
  shopName,
  ordering = true,
}: {
  table: PublicTableContext;
  shopName: string;
  ordering?: boolean;
}) {
  return (
    <div className="current-table" role="status" aria-label="Current table">
      <FiMapPin aria-hidden="true" />
      <div>
        <strong>
          {ordering ? "Ordering for" : "Scanned"} Table {table.number}
        </strong>
        <span>
          {ordering ? "Dine-in at" : "Table QR at"} {shopName}
        </span>
      </div>
    </div>
  );
}
