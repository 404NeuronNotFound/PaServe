import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { RegistrationForm } from "./RegistrationForm";
import { registerAccount } from "../api/register";
import { REGISTRATION_ACKNOWLEDGEMENT } from "@paserve/contracts";

vi.mock("../api/register", () => ({ registerAccount: vi.fn() }));
const register = vi.mocked(registerAccount);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function setup() {
  const success = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RegistrationForm onSuccess={success} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), success };
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  confirm = "a long test passphrase",
) {
  await user.type(screen.getByLabelText("Email address"), "Owner@Example.com");
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "a long test passphrase",
  );
  await user.type(screen.getByLabelText("Confirm password"), confirm);
}

describe("Registration form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("escalates only on the server challenge response and keeps registration data for manual retry", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
    let options!: Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
    const renderWidget = vi.fn((_element: HTMLElement, value: typeof options) => { options = value; return "registration-widget"; });
    vi.stubGlobal("turnstile", { render: renderWidget, remove: vi.fn() });
    const error = new AxiosError("Challenge");
    error.response = { status: 403, statusText: "Forbidden", headers: {}, config: { headers: new AxiosHeaders() }, data: { code: "BOT_CHALLENGE_REQUIRED" } };
    const result = { message: REGISTRATION_ACKNOWLEDGEMENT };
    register.mockRejectedValueOnce(error).mockResolvedValueOnce(result);
    const { user, success } = setup();
    expect(screen.queryByRole("group", { name: "Security check" })).toBeNull();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
    expect(options.action).toBe("register");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("a long test passphrase");
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    act(() => options.callback("registration-proof"));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(success).toHaveBeenCalledWith(result, "owner@example.com"));
    expect(register.mock.calls.at(-1)?.[0]).toMatchObject({ challengeToken: "registration-proof" });
    expect(register).toHaveBeenCalledTimes(2);
  });
  it("explains an unknown creation outcome without automatically registering again", async () => {
    register.mockRejectedValueOnce(new AxiosError("private network diagnostic", "ERR_NETWORK"));
    const { user } = setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("try signing in with these details before registering again");
    expect(screen.getByLabelText("Email address")).toHaveValue("Owner@Example.com");
    expect(register).toHaveBeenCalledTimes(1);
  });
  it("validates required fields before making a request", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirm your password.")).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email address")).toHaveFocus();
  });
  it("validates only visited fields and updates feedback while correcting them", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Email address"), "wrong");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.tab();
    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Confirm your password."),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Email address"), "@example.com");
    expect(
      screen.queryByText("Enter a valid email address."),
    ).not.toBeInTheDocument();
  });
  it("rechecks confirmation when the original password changes", async () => {
    const { user } = setup();
    await fill(user);
    await user.tab();
    await user.type(
      screen.getByLabelText("Password", { exact: true }),
      "changed",
    );
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });
  it("allows keyboard users to reveal passwords without losing their values", async () => {
    const { user } = setup();
    await fill(user);
    screen.getByRole("button", { name: "Show passwords" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByLabelText("Confirm password")).toHaveValue(
      "a long test passphrase",
    );
    expect(
      screen.getByRole("button", { name: "Hide passwords" }),
    ).toHaveFocus();
  });
  it("blocks mismatched confirmation", async () => {
    const { user } = setup();
    await fill(user, "different passphrase");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
  it("submits only normalized email and password and clears password fields", async () => {
    const result = {
      message: REGISTRATION_ACKNOWLEDGEMENT,
    };
    register.mockResolvedValue(result);
    const { user, success } = setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => expect(success).toHaveBeenCalledWith(result, "owner@example.com"));
    expect(register.mock.calls[0]?.[0]).toEqual({
      email: "owner@example.com",
      password: "a long test passphrase",
    });
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
  });
  it("shows retry guidance for throttling without account-existence feedback", async () => {
    const error = new AxiosError("Conflict");
    error.response = {
      data: { code: "RATE_LIMIT_EXCEEDED" },
      status: 429,
      statusText: "Conflict",
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
    register.mockRejectedValue(error);
    const { user } = setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(
      await screen.findByText("Too many registration attempts. Please wait and try again."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveFocus(),
    );
  });
  it("blocks duplicate submissions while a request is pending", async () => {
    let finish: (
      value: Awaited<ReturnType<typeof registerAccount>>,
    ) => void = () => {};
    register.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { user, success } = setup();
    await fill(user);
    await user.dblClick(
      screen.getByRole("button", { name: /create account/i }),
    );
    expect(register).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /creating account/i }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Creating your account. Please wait.",
    );
    finish({
      message: REGISTRATION_ACKNOWLEDGEMENT,
    });
    await waitFor(() => expect(success).toHaveBeenCalled());
  });
  it("shows a retryable message for network failures without exposing details", async () => {
    register.mockRejectedValue(new Error("internal network diagnostic"));
    const { user } = setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(
      await screen.findByText(
        "We couldn’t create your account. Please try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("internal network diagnostic"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeEnabled();
  });
});
