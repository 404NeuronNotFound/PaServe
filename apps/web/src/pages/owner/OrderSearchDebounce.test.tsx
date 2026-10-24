import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { OrderSearch } from "./OrderSearch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup() {
  const changed = vi.fn();
  function Host() {
    const [search, setSearch] = useState("");
    return (
      <OrderSearch
        search={search}
        onSearch={(value) => {
          changed(value);
          setSearch(value);
        }}
      />
    );
  }
  return {
    ...render(<Host />),
    changed,
    input: () => screen.getByRole("searchbox"),
  };
}
it("sends only the final normalized term after a 400ms typing pause", () => {
  const { changed, input } = setup();
  fireEvent.change(input(), { target: { value: "P" } });
  act(() => vi.advanceTimersByTime(300));
  fireEvent.change(input(), { target: { value: " Patio " } });
  act(() => vi.advanceTimersByTime(399));
  expect(changed).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(changed).toHaveBeenCalledExactlyOnceWith("Patio");
  fireEvent.change(input(), { target: { value: "Patio" } });
  act(() => vi.advanceTimersByTime(400));
  expect(changed).toHaveBeenCalledTimes(1);
});
it("Enter commits immediately without a later duplicate and Clear cancels pending work", () => {
  const { changed, input } = setup();
  fireEvent.change(input(), { target: { value: "A" } });
  fireEvent.submit(screen.getByRole("search"));
  expect(changed).toHaveBeenCalledExactlyOnceWith("A");
  act(() => vi.advanceTimersByTime(400));
  expect(changed).toHaveBeenCalledTimes(1);
  fireEvent.change(input(), { target: { value: "B" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(changed).toHaveBeenLastCalledWith("");
  act(() => vi.advanceTimersByTime(400));
  expect(changed).toHaveBeenCalledTimes(2);
  expect(input()).toHaveFocus();
});
it("waits for composition to finish, validates text and cancels when unmounted", () => {
  const { changed, input, unmount } = setup();
  fireEvent.compositionStart(input());
  fireEvent.change(input(), { target: { value: "桌" } });
  act(() => vi.advanceTimersByTime(1000));
  expect(changed).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input(), { data: "桌" });
  act(() => vi.advanceTimersByTime(400));
  expect(changed).toHaveBeenCalledExactlyOnceWith("桌");
  fireEvent.change(input(), { target: { value: "x".repeat(81) } });
  expect(screen.getByRole("alert")).toHaveTextContent("at most 80");
  fireEvent.change(input(), { target: { value: "pending" } });
  unmount();
  act(() => vi.advanceTimersByTime(400));
  expect(changed).toHaveBeenCalledTimes(1);
});
