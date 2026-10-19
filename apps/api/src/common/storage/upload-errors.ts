/** A rejected immutable upload does not own the object already at that key. */
export function isStorageConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return (
    candidate.status === 409 ||
    candidate.status === '409' ||
    candidate.statusCode === 409 ||
    candidate.statusCode === '409'
  );
}
