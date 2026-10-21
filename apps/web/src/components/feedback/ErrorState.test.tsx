import { afterEach, expect, it, vi, describe, beforeEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorState } from "./ErrorState";

describe.each(["day", "night"] as const)("%s appearance", (appearance) => {

afterEach(cleanup);
const failure = (status: number) => ({ isAxiosError: true, response: { status } });

it.each([400, 401, 403, 404, 422])("does not offer a blind retry for status %s", (status) => {
  const retry = vi.fn();
  render(<ErrorState error={failure(status)} resource="your orders" onRetry={retry} />);
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  if (status === 401) expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
  if (status === 403) expect(screen.getByRole("link", { name: "Choose another shop" })).toHaveAttribute("href", "/app/shops");
});

it("guards repeated safe retries and restores retry after a rejected request", async () => {
  let reject!: (reason: unknown) => void;
  const retry = vi.fn().mockReturnValueOnce(new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const view = render(<ErrorState error={failure(503)} resource="your orders" onRetry={retry} />);
  const user = userEvent.setup();
  await user.dblClick(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  view.rerender(<ErrorState error={failure(503)} resource="your orders" onRetry={retry} pending />);
  expect(screen.getByRole("button", { name: "Retrying your orders…" })).toBeDisabled();
  await act(async () => reject(new Error("Offline")));
  view.rerender(<ErrorState error={failure(503)} resource="your orders" onRetry={retry} />);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(2);
});

it("keeps public recovery in the customer context", () => {
  render(<ErrorState error={failure(404)} resource="this product" product publicView>
    <button>Back to menu</button>
  </ErrorState>);
  expect(screen.getByRole("button", { name: "Back to menu" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Choose another shop" })).not.toBeInTheDocument();
});

  beforeEach(() => { document.documentElement.dataset.appearance = appearance; });
  afterEach(() => { delete document.documentElement.dataset.appearance; });
});
