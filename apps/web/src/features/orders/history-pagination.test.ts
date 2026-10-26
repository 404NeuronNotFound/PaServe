import { expect, it } from "vitest";
import type { HistoryPagination } from "@paserve/contracts";
import { validHistoryPagination } from "./history-pagination";

const valid: HistoryPagination = { page: 1, pageSize: 12, pageCount: 2, total: 13, snapshot: "2026-10-17T00:00:00.000Z", hasNew: false };

it("accepts consistent full, last and empty pages", () => {
  expect(validHistoryPagination(valid, 12)).toBe(true);
  expect(validHistoryPagination({ ...valid, page: 2 }, 1)).toBe(true);
  expect(validHistoryPagination({ ...valid, pageCount: 1, total: 0 }, 0)).toBe(true);
  expect(validHistoryPagination(undefined, 25)).toBe(true);
});

it.each([
  { page: 0 }, { page: 3 }, { pageSize: 8 }, { pageCount: 3 },
  { total: -1 }, { total: 13.5 }, { snapshot: "bad" },
  { snapshot: "2026-02-30T00:00:00.000Z" }, { hasNew: "yes" },
])("rejects malformed numbered metadata: %j", (change) => {
  expect(validHistoryPagination({ ...valid, ...change } as HistoryPagination, 12)).toBe(false);
});

it("rejects records inconsistent with the reported page size and total", () => {
  expect(validHistoryPagination(valid, 13)).toBe(false);
  expect(validHistoryPagination(valid, 1)).toBe(false);
  expect(validHistoryPagination({ ...valid, page: 2 }, 12)).toBe(false);
});
