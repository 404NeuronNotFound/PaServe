import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { compactPageNumbers } from "../../lib/list-page";

/** Cursor lists omit pageCount: never imply the server returned a global total. */
export function ListPagination({
  label, page, pageCount, hasNext, pending = false, onPrevious, onNext, onPage, className,
  previousLabel = "Previous", nextLabel = "Next",
}: {
  label: string;
  page: number;
  pageCount?: number;
  hasNext: boolean;
  pending?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPage?: (page: number) => void;
  previousLabel?: string;
  nextLabel?: string;
  className?: string;
}) {
  return (
    <nav className={cn("management-pagination", onPage && pageCount !== undefined && "management-pagination-numbered", className)} aria-label={label}>
      <Button type="button" variant="outline" aria-label={previousLabel} disabled={pending || page <= 1} onClick={onPrevious}>
        <FiChevronLeft aria-hidden="true" /><span className="pagination-button-label">{previousLabel}</span>
      </Button>
      {onPage && pageCount !== undefined && <div className="pagination-page-numbers">
        {compactPageNumbers(page, pageCount).map((number, index) => typeof number === "number" ? (
          <Button key={number} type="button" variant="outline" aria-label={`Go to page ${number}`} aria-current={number === page ? "page" : undefined}
            disabled={pending} onClick={() => onPage(number)}>{number}</Button>
        ) : <span key={`gap-${index}`} className="pagination-ellipsis" aria-hidden="true">…</span>)}
      </div>}
      <span role={pending ? undefined : "status"} aria-atomic="true">
        Page {page}{pageCount !== undefined ? ` of ${pageCount}` : ""}
      </span>
      <Button type="button" variant="outline" aria-label={nextLabel} disabled={pending || !hasNext} onClick={onNext}>
        <span className="pagination-button-label">{nextLabel}</span><FiChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
