/** UUIDs and legacy safe IDs are single URL segments, never paths or dot segments. */
export function isOrderReceiptId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$(?![\s\S])/.test(value)
  );
}

/** Match the server's positive signed-bigint numbering scope without losing precision. */
export function isOrderNumber(value: unknown): value is string {
  if (typeof value !== "string" || !/^ORD-\d{6,19}$(?![\s\S])/.test(value))
    return false;
  const sequence = BigInt(value.slice(4));
  return sequence > 0n && sequence <= 9223372036854775807n;
}

export function isOrderTotal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,9})\.\d{2}$(?![\s\S])/.test(value)
  );
}
