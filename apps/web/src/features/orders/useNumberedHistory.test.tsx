import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useNumberedHistory } from "./useNumberedHistory";
import type { HistoryPagination } from "@paserve/contracts";

it("holds the server cutoff across page reads and resets it on refresh or filter changes", async () => {
  const pagination: HistoryPagination = {
    page: 1,
    pageSize: 12,
    pageCount: 3,
    total: 25,
    snapshot: "2026-10-17T00:00:00.000Z",
    hasNew: false,
  };
  const read = vi.fn().mockResolvedValue({ pagination });
  const view = renderHook(({ scope }) => useNumberedHistory(scope), {
    initialProps: { scope: "all" },
  });
  await act(() => view.result.current.load(read));
  expect(read).toHaveBeenLastCalledWith({ page: 1 });
  act(() => view.result.current.go(3));
  await act(() => view.result.current.load(read));
  expect(read).toHaveBeenLastCalledWith({
    page: 3,
    snapshot: pagination.snapshot,
  });
  await act(() => view.result.current.load(read));
  expect(read).toHaveBeenLastCalledWith({
    page: 3,
    snapshot: pagination.snapshot,
  });
  act(() => view.result.current.refresh());
  await act(() => view.result.current.load(read));
  expect(read).toHaveBeenLastCalledWith({ page: 1 });
  act(() => view.result.current.go(2));
  view.rerender({ scope: "search" });
  await act(() => view.result.current.load(read));
  expect(read).toHaveBeenLastCalledWith({ page: 1 });
  view.rerender({ scope: "all" });
  await act(() => view.result.current.load(read));
  expect(read).toHaveBeenLastCalledWith({ page: 1 });
});

it("discards snapshots from previous views and ignores a late previous-view response", async () => {
  const pagination: HistoryPagination = {
    page: 1,
    pageSize: 12,
    pageCount: 2,
    total: 13,
    snapshot: "2026-10-17T00:00:00.000Z",
    hasNew: false,
  };
  const view = renderHook(({ scope }) => useNumberedHistory(scope), {
    initialProps: { scope: "shop-a" },
  });
  let finishOld!: (value: { pagination: HistoryPagination }) => void;
  const pending = view.result.current.load(
    () =>
      new Promise<{ pagination: HistoryPagination }>((resolve) => {
        finishOld = resolve;
      }),
  );
  view.rerender({ scope: "shop-b" });
  const newPagination = { ...pagination, snapshot: "2026-10-18T00:00:00.000Z" };
  const read = vi.fn().mockResolvedValue({ pagination: newPagination });
  await act(() => view.result.current.load(read));
  await act(async () => {
    finishOld({ pagination });
    await pending;
  });
  act(() => view.result.current.go(2));
  await act(() => view.result.current.load(read));
  expect(read).toHaveBeenLastCalledWith({
    page: 2,
    snapshot: newPagination.snapshot,
  });
  // Returning to an old view starts afresh; no historical cutoff is retained.
  view.rerender({ scope: "shop-a" });
  await act(() => view.result.current.load(read));
  expect(read).toHaveBeenLastCalledWith({ page: 1 });
});
