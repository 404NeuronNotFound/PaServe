import { expect, it } from "vitest";
import { isReceiptTimestamp } from "@paserve/contracts";
import { formatReceiptDateTime } from "./receipt-date-time";

it('formats UTC instants in Manila across date and year boundaries', () => {
  expect(formatReceiptDateTime('2026-12-31T16:30:45Z')).toMatch(/Jan 01, 2027.*12:30:45.*AM.*GMT\+8/);
  expect(formatReceiptDateTime('2026-10-16T00:01:02.000Z')).toMatch(/Oct 16, 2026.*08:01:02.*AM.*GMT\+8/);
});
it.each(['2026-10-16T08:00:00', '2026-02-30T00:00:00Z', 'not a date', '2026-10-16'])(
'rejects ambiguous or invalid timestamps: %s', (value) => {
  expect(isReceiptTimestamp(value)).toBe(false);
  expect(formatReceiptDateTime(value)).toBe('Unavailable');
});
