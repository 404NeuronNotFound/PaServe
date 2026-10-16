import { isReceiptTimestamp } from "@paserve/contracts";

/** Approved receipt strategy; independent of device language/timezone. */
export const RECEIPT_LOCALE = "en-PH";
export const RECEIPT_TIME_ZONE = "Asia/Manila";
const receiptDate = new Intl.DateTimeFormat(RECEIPT_LOCALE, {
  timeZone: RECEIPT_TIME_ZONE,
  year: "numeric", month: "short", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: true, timeZoneName: "shortOffset",
});
export function formatReceiptDateTime(value: string): string {
  return isReceiptTimestamp(value) ? receiptDate.format(new Date(value)) : "Unavailable";
}
