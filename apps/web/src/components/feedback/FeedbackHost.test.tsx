import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeedbackHost } from "./FeedbackHost";
import { feedback, useFeedbackStore } from "../../app/stores/feedback";
import { AppearanceToggle } from "../layout/AppearanceToggle";
import { useAppearanceStore } from "../../app/stores/appearance";

beforeEach(() => {
  vi.useFakeTimers();
  useFeedbackStore.getState().clear();
  useAppearanceStore.getState().setAppearance("day");
});
afterEach(() => {
  cleanup();
  useFeedbackStore.getState().clear();
  useAppearanceStore.getState().setAppearance("day");
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const advance = (duration: number) =>
  act(() => {
    vi.advanceTimersByTime(duration);
  });

it.each([2000, 3000, 4000] as const)(
  "dismisses a passive toast after %i milliseconds without moving focus",
  (duration) => {
    render(
      <>
        <input aria-label="Current field" />
        <FeedbackHost />
      </>,
    );
    screen.getByRole("textbox").focus();
    act(() => feedback.toast("Saved.", { duration }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(screen.getByRole("textbox")).toHaveFocus();
    advance(duration - 1);
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  },
);

it("queues updates and gives each its own visible duration", () => {
  render(<FeedbackHost />);
  act(() => {
    feedback.toast("First update.");
    feedback.toast("Second update.");
  });
  expect(screen.getByText("First update.")).toBeInTheDocument();
  expect(screen.queryByText("Second update.")).not.toBeInTheDocument();
  advance(3000);
  expect(screen.getByText("Second update.")).toBeInTheDocument();
  advance(3000);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("pauses expiration on hover and resumes with the remaining duration", () => {
  render(<FeedbackHost />);
  act(() => feedback.toast("Saved."));
  advance(1000);
  const message = screen.getByRole("status").parentElement!;
  fireEvent.pointerEnter(message);
  advance(10000);
  expect(screen.getByText("Saved.")).toBeInTheDocument();
  fireEvent.pointerLeave(message);
  advance(1999);
  expect(screen.getByText("Saved.")).toBeInTheDocument();
  advance(1);
  expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
});

it("keeps a snackbar available while its action has keyboard focus", () => {
  render(<FeedbackHost />);
  act(() => feedback.snackbar("Changed.", { label: "Undo", onClick: vi.fn() }));
  advance(1000);
  act(() => screen.getByRole("button", { name: "Undo" }).focus());
  advance(10000);
  expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
  act(() => screen.getByRole("button", { name: "Undo" }).blur());
  advance(7000);
  expect(screen.queryByText("Changed.")).not.toBeInTheDocument();
});

it("pauses the timer while the browser tab is hidden", () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  render(<FeedbackHost />);
  act(() => feedback.toast("Saved."));
  advance(1000);
  hidden.mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  advance(10000);
  expect(screen.getByText("Saved.")).toBeInTheDocument();
  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  advance(2000);
  expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
});

it("runs the snackbar action once and dismisses it after success", async () => {
  const action = vi.fn();
  render(
    <>
      <button>Original action</button>
      <FeedbackHost />
    </>,
  );
  screen.getByRole("button", { name: "Original action" }).focus();
  act(() => feedback.snackbar("Changed.", { label: "Undo", onClick: action }));
  act(() => screen.getByRole("button", { name: "Undo" }).focus());
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Undo" })),
  );
  expect(action).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Changed.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Original action" })).toHaveFocus();
});

it("prevents double actions and expiration while an asynchronous action is pending", async () => {
  let resolve!: () => void;
  const action = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<FeedbackHost />);
  act(() => feedback.snackbar("Changed.", { label: "Undo", onClick: action }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("button", { name: "Undoing…" })).toBeDisabled();
  advance(30000);
  expect(screen.getByText("Changed.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undoing…" }));
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(screen.queryByText("Changed.")).not.toBeInTheDocument();
});

it("keeps a failed snackbar action recoverable instead of silently dismissing it", async () => {
  const action = vi
    .fn()
    .mockRejectedValueOnce(new Error("Internal details"))
    .mockResolvedValueOnce(undefined);
  render(<FeedbackHost />);
  act(() => feedback.snackbar("Changed.", { label: "Undo", onClick: action }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Undo" })),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The action could not be completed.",
  );
  expect(screen.queryByText("Internal details")).not.toBeInTheDocument();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Undo" })),
  );
  expect(screen.queryByText("Changed.")).not.toBeInTheDocument();
});

it("keeps a persistent banner across transient clearing until explicitly dismissed", () => {
  render(<FeedbackHost />);
  act(() => {
    feedback.banner("maintenance", "Scheduled maintenance at 10 PM.");
    feedback.toast("Saved.");
  });
  act(() => feedback.clearTransient());
  advance(30000);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Scheduled maintenance at 10 PM.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("shows a provided recovery message for a failed Undo while hiding internal errors", async () => {
  render(<FeedbackHost />);
  act(() =>
    feedback.snackbar("Category hidden.", {
      label: "Undo",
      onClick: () => Promise.reject(new Error("Internal database details")),
      errorMessage: () =>
        "Visibility changed elsewhere. Refresh the categories before trying again.",
    }),
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Undo" })),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Visibility changed elsewhere.",
  );
  expect(
    screen.queryByText("Internal database details"),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
});

it("replaces an appearance snackbar and undoes the most recent change", async () => {
  render(
    <>
      <AppearanceToggle />
      <FeedbackHost />
    </>,
  );
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText("Night appearance enabled.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch"));
  expect(
    screen.queryByText("Night appearance enabled."),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Day appearance enabled.")).toBeInTheDocument();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Undo" })),
  );
  expect(screen.getByRole("switch")).toBeChecked();
  expect(localStorage.getItem("paserve-appearance")).toBe("night");
});
