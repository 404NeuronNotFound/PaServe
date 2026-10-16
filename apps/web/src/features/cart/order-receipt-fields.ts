/** UUIDs and legacy safe IDs are single URL segments, never paths or dot segments. */
export function isOrderReceiptId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$(?![\s\S])/.test(value)
  );
}

/** Share the cashier/kitchen contract without changing the saved display value. */
export { isValidOrderNumber as isOrderNumber } from "@paserve/contracts";

export function isOrderTotal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,9})\.\d{2}$(?![\s\S])/.test(value)
  );
}
