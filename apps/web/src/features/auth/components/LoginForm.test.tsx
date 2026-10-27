import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
function setup(initialEmail?: string) {
  const success = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginForm onSuccess={success} initialEmail={initialEmail} />
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
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("loads a challenge only when requested, preserves inputs, and sends a proof on manual retry", async () => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
  let options!: Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
  const renderWidget = vi.fn((_element: HTMLElement, value: typeof options) => { options = value; return "login-widget"; });
  vi.stubGlobal("turnstile", { render: renderWidget, remove: vi.fn() });
  const error = new AxiosError("Challenge");
  error.response = { status: 403, statusText: "Forbidden", headers: {}, config: { headers: new AxiosHeaders() }, data: { code: "BOT_CHALLENGE_REQUIRED" } };
  login.mockRejectedValueOnce(error).mockResolvedValueOnce(session);
  const { user, success } = setup();
  expect(screen.queryByRole("group", { name: "Security check" })).toBeNull();
  expect(renderWidget).not.toHaveBeenCalled();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("group", { name: "Security check" })).toBeInTheDocument();
  await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Password")).toHaveValue("  test passphrase  ");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  expect(login).toHaveBeenCalledOnce();
  act(() => options.callback("login-proof"));
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(success).toHaveBeenCalledWith(session));
  expect(login.mock.calls.at(-1)?.[0]).toMatchObject({ challengeToken: "login-proof", email: "owner@example.com" });
  expect(login.mock.calls[0][0]).not.toHaveProperty("challengeToken");
});

it("does not reuse a proof after a failed attempt or resubmit automatically on challenge expiry", async () => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
  const configurations: Parameters<NonNullable<Window["turnstile"]>["render"]>[1][] = [];
  vi.stubGlobal("turnstile", { render: vi.fn((_element: HTMLElement, value: typeof configurations[number]) => { configurations.push(value); return "widget"; }), remove: vi.fn() });
  const error = new AxiosError("Challenge");
  error.response = { status: 403, statusText: "Forbidden", headers: {}, config: { headers: new AxiosHeaders() }, data: { code: "BOT_CHALLENGE_REQUIRED" } };
  const invalid = new AxiosError("Invalid");
  invalid.response = { ...error.response, status: 401, data: { code: "INVALID_CREDENTIALS" } };
  login.mockRejectedValueOnce(error).mockRejectedValueOnce(invalid);
  const { user } = setup();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(configurations).toHaveLength(1));
  act(() => configurations[0].callback("one-proof"));
  act(() => configurations[0]["expired-callback"]());
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  expect(login).toHaveBeenCalledOnce();
  act(() => configurations[0].callback("fresh-proof"));
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(configurations).toHaveLength(2));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  expect(login).toHaveBeenCalledTimes(2);
});
it("explains a sign-in connection failure while preserving the credentials for retry", async () => {
  login.mockRejectedValueOnce(new AxiosError("private network diagnostic", "ERR_NETWORK"));
  const { user } = setup();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  expect(screen.getByLabelText("Password")).toHaveValue("  test passphrase  ");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  expect(screen.queryByText("private network diagnostic")).not.toBeInTheDocument();
});

it("carries a newly registered email into sign-in while keeping the password empty", () => {
  setup("staff@example.com");
  expect(screen.getByLabelText("Email address")).toHaveValue(
    "staff@example.com",
  );
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(login).not.toHaveBeenCalled();
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
    keepSignedIn: false,
  });
  expect(screen.getByLabelText("Password")).toHaveValue("");
});

it("offers persistent sign-in only when the user selects a personal device", async () => {
  login.mockResolvedValue(session);
  const { user } = setup();
  const preference = screen.getByRole("checkbox", { name: "Keep me signed in" });
  expect(preference).not.toBeChecked();
  expect(screen.getByText(/Shared device: sign in for up to 8 hours/)).toBeVisible();
  await user.click(preference);
  expect(screen.getByText(/Personal device: stay signed in for up to 7 days/)).toBeVisible();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(login.mock.calls[0]?.[0]).toMatchObject({ keepSignedIn: true }));
});

it.each([401, 429, 500, 503])(
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
          : "Sign-in is temporarily unavailable",
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
