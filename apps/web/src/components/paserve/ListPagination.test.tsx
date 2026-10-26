import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListPagination } from "./ListPagination";
import { compactPageNumbers, listPage } from "../../lib/list-page";

afterEach(cleanup);

it("keeps compact page links valid at the beginning, middle and end", async () => {
  expect(compactPageNumbers(1, 7)).toEqual([1, 2, "ellipsis", 7]);
  expect(compactPageNumbers(4, 7)).toEqual([1, "ellipsis", 4, "ellipsis", 7]);
  expect(compactPageNumbers(7, 7)).toEqual([1, "ellipsis", 6, 7]);
  expect(compactPageNumbers(1, 1)).toEqual([1]);
  expect(compactPageNumbers(1, 2)).toEqual([1, 2]);
  const onPage = vi.fn();
  const props = { label: "Numbered pages", page: 1, pageCount: 7, hasNext: true, onPrevious: vi.fn(), onNext: vi.fn(), onPage };
  const view = render(<ListPagination {...props} />);
  expect(screen.getByRole("button", { name: "Go to page 1" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("button", { name: "Go to page 5" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Go to page 7" }));
  expect(onPage).toHaveBeenCalledWith(7);
  view.rerender(<ListPagination {...props} pending />);
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
});

it("clamps a local page after filtering, removal and empty results", () => {
  const records = Array.from({ length: 21 }, (_, index) => index);
  expect(listPage(records, 3, 10)).toMatchObject({ page: 3, pageCount: 3, first: 21, last: 21, records: [20], hasNext: false });
  expect(listPage(records.slice(0, 2), 3, 10)).toMatchObject({ page: 1, first: 1, last: 2, records: [0, 1] });
  expect(listPage([], 9, 10)).toMatchObject({ page: 1, pageCount: 1, first: 0, last: 0, hasNext: false });
});

it("uses cursor availability without inventing a total and locks pending navigation", async () => {
  const previous = vi.fn(), next = vi.fn();
  const props = { label: "Orders pagination", page: 1, hasNext: true, onPrevious: previous, onNext: next };
  const view = render(<ListPagination {...props} />);
  const nav = within(screen.getByRole("navigation", { name: "Orders pagination" }));
  expect(nav.getByRole("status")).toHaveTextContent(/^Page 1$/);
  expect(nav.getByRole("button", { name: "Previous" })).toBeDisabled();
  await userEvent.click(nav.getByRole("button", { name: "Next" }));
  expect(next).toHaveBeenCalledOnce();
  view.rerender(<ListPagination {...props} page={2} pending />);
  for (const button of nav.getAllByRole("button")) expect(button).toBeDisabled();
  view.rerender(<ListPagination {...props} page={2} pageCount={2} hasNext={false} />);
  expect(nav.getByRole("status")).toHaveTextContent("Page 2 of 2");
  expect(nav.getByRole("button", { name: "Next" })).toBeDisabled();
  await userEvent.click(nav.getByRole("button", { name: "Previous" }));
  expect(previous).toHaveBeenCalledOnce();
});
