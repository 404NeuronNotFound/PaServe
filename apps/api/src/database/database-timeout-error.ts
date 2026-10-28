/** Read only structured driver codes; never match or expose SQL/error wording. */
export function databaseTimeoutKind(
  error: unknown,
  depth = 0,
): 'deadline' | 'busy' | undefined {
  if (!error || typeof error !== 'object' || depth > 4) return undefined;
  const value = error as Record<string, unknown>;
  const code = value.originalCode ?? value.code;
  if (code === '57014' || code === '25P03') return 'deadline';
  if (code === '55P03' || code === 'P2024') return 'busy';
  return (
    databaseTimeoutKind(value.meta, depth + 1) ??
    databaseTimeoutKind(value.cause, depth + 1) ??
    databaseTimeoutKind(value.driverAdapterError, depth + 1)
  );
}
