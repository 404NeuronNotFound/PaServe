import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { LoginForm } from "./LoginForm";
import { loginAccount } from "../api/session";

vi.mock("../api/session", () => ({ loginAccount: vi.fn() }));
const login = vi.mocked(loginAccount);
const session = {
  user: {
    id: "user-id",
    email: "owner@example.com",
    createdAt: "2026-10-08T00:00:00Z",
  },
  accessToken: "test-access-token",
  tokenType: "Bearer" as const,
  expiresIn: 900,
};
function setup() {
  const success = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginForm onSuccess={success} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), success };
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email address"), "Owner@Example.com");
  await user.type(screen.getByLabelText("Password"), "  test passphrase  ");
}
beforeEach(() => {
  vi.resetAllMocks();
});

it("blocks invalid inputs and focuses the first error", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  expect(screen.getByText("Enter your password.")).toBeInTheDocument();
  expect(screen.getByLabelText("Email address")).toHaveFocus();
  expect(login).not.toHaveBeenCalled();
});

it("normalizes email, preserves password whitespace and clears password after success", async () => {
  login.mockResolvedValue(session);
  const { user, success } = setup();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(success).toHaveBeenCalledWith(session));
  expect(login.mock.calls[0]?.[0]).toEqual({
    email: "owner@example.com",
    password: "  test passphrase  ",
  });
  expect(screen.getByLabelText("Password")).toHaveValue("");
});

it.each([401, 429, 500])(
  "shows recoverable feedback for HTTP %s without exposing diagnostics",
  async (status) => {
    const error = new AxiosError("private diagnostic");
    error.response = {
      status,
      statusText: "Failure",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    };
    login.mockRejectedValue(error);
    const { user } = setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      status === 401
        ? "Email or password is incorrect"
        : status === 429
          ? "Too many sign-in attempts"
          : "We couldn’t sign you in",
    );
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText("Password")).toHaveValue(
      "  test passphrase  ",
    );
    expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
  },
);

it("allows one pending request and announces progress", async () => {
  let finish: (value: typeof session) => void = () => {};
  login.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { user, success } = setup();
  await fill(user);
  await user.dblClick(screen.getByRole("button", { name: "Sign in" }));
  expect(login).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Signing you in. Please wait.",
  );
  finish(session);
  await waitFor(() => expect(success).toHaveBeenCalled());
});
