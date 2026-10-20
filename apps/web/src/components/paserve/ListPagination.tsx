import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

/** Cursor lists omit pageCount: never imply the server returned a global total. */
export function ListPagination({
  label, page, pageCount, hasNext, pending = false, onPrevious, onNext, className,
}: {
  label: string;
  page: number;
  pageCount?: number;
  hasNext: boolean;
  pending?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}) {
  return (
    <nav className={cn("management-pagination", className)} aria-label={label}>
      <Button variant="outline" disabled={pending || page <= 1} onClick={onPrevious}>Previous</Button>
      <span role={pending ? undefined : "status"} aria-atomic="true">
        Page {page}{pageCount !== undefined ? ` of ${pageCount}` : ""}
      </span>
      <Button variant="outline" disabled={pending || !hasNext} onClick={onNext}>Next</Button>
    </nav>
  );
}
