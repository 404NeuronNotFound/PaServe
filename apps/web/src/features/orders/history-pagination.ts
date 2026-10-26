import type { HistoryPagination } from "@paserve/contracts";

export function validHistoryPagination(
  value: HistoryPagination | undefined,
  length: number,
): boolean {
  if (value === undefined) return true; // Legacy cursor responses remain supported.
  return (
    value !== null &&
    value.pageSize === 12 &&
    Number.isSafeInteger(value.total) &&
    value.total >= 0 &&
    Number.isSafeInteger(value.pageCount) &&
    value.pageCount === Math.max(1, Math.ceil(value.total / 12)) &&
    Number.isSafeInteger(value.page) &&
    value.page >= 1 &&
    value.page <= value.pageCount &&
    typeof value.hasNew === "boolean" &&
    typeof value.snapshot === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.snapshot) &&
    Number.isFinite(Date.parse(value.snapshot)) &&
    new Date(value.snapshot).toISOString() === value.snapshot &&
    length === Math.min(12, Math.max(0, value.total - (value.page - 1) * 12))
  );
}
