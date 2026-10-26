/** Keep first, current (or second), and last pages reachable in a narrow footer. */
export function compactPageNumbers(page: number, pageCount: number): (number | "ellipsis")[] {
  const pages = [...new Set([1, Math.max(2, Math.min(page, pageCount - 1)), pageCount])]
    .filter((number) => number <= pageCount);
  return pages.flatMap((number, index): (number | "ellipsis")[] =>
    index > 0 && number - pages[index - 1] > 1 ? ["ellipsis", number] : [number]);
}

/** Page already-filtered records. Clamp after refresh/removal, including empty lists. */
export function listPage<T>(records: readonly T[], requestedPage: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(records.length / size));
  const page = Math.max(1, Math.min(Math.floor(requestedPage), pageCount));
  const offset = (page - 1) * size;
  return {
    page, pageCount,
    records: records.slice(offset, offset + size),
    first: records.length ? offset + 1 : 0,
    last: Math.min(offset + size, records.length),
    total: records.length,
    hasNext: page < pageCount,
  };
}
