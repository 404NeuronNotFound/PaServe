/** Customer-facing reference; never an authorization credential. */
export function formatOrderNumber(sequence: bigint): string {
  if (sequence < 1n || sequence > 9223372036854775807n)
    throw new Error('Invalid shop order sequence.');
  return `ORD-${sequence.toString().padStart(6, '0')}`;
}
