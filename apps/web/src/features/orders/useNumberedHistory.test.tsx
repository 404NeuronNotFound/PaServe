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
