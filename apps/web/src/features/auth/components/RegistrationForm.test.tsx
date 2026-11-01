import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { RegistrationForm } from "./RegistrationForm";
import { registerAccount, requestEmailCode } from "../api/register";
import { REGISTRATION_ACKNOWLEDGEMENT } from "@paserve/contracts";

vi.mock("../api/register", () => ({
  registerAccount: vi.fn(),
  requestEmailCode: vi.fn(),
}));
const sendCode = vi.mocked(requestEmailCode);
const register = vi.mocked(registerAccount);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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
  requestCode = true,
) {
  await user.type(screen.getByLabelText("First name"), "Ada");
  await user.type(screen.getByLabelText("Last name"), "Lovelace");
  await user.type(screen.getByLabelText("Email address"), "Owner@Example.com");
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "a long test passphrase",
  );
  await user.type(screen.getByLabelText("Confirm password"), confirm);
  if (requestCode && confirm === "a long test passphrase") {
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.type(
      await screen.findByLabelText("Email verification code"),
      "123456",
    );
  }
}

describe("Registration form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendCode.mockResolvedValue({ message: "Check your inbox." });
  });
  it("escalates only on the server challenge response and keeps registration data for manual retry", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
    let options!: Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
    const renderWidget = vi.fn(
      (_element: HTMLElement, value: typeof options) => {
        options = value;
        return "registration-widget";
      },
    );
    vi.stubGlobal("turnstile", { render: renderWidget, remove: vi.fn() });
    const error = new AxiosError("Challenge");
    error.response = {
      status: 403,
      statusText: "Forbidden",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { code: "BOT_CHALLENGE_REQUIRED" },
    };
    const result = { message: REGISTRATION_ACKNOWLEDGEMENT };
    register.mockRejectedValueOnce(error).mockResolvedValueOnce(result);
    const { user, success } = setup();
    expect(screen.queryByRole("group", { name: "Security check" })).toBeNull();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
    expect(options.action).toBe("register");
    expect(screen.getByLabelText("Confirm password")).toHaveValue(
      "a long test passphrase",
    );
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeDisabled();
    act(() => options.callback("registration-proof"));
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(result, "owner@example.com"),
    );
    expect(register.mock.calls.at(-1)?.[0]).toMatchObject({
      challengeToken: "registration-proof",
    });
    expect(register).toHaveBeenCalledTimes(2);
  });
  it("explains an unknown creation outcome without automatically registering again", async () => {
    register.mockRejectedValueOnce(
      new AxiosError("private network diagnostic", "ERR_NETWORK"),
    );
    const { user } = setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "try signing in with these details before registering again",
    );
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "Owner@Example.com",
    );
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
    expect(screen.getByLabelText("First name")).toHaveFocus();
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
    await fill(user, "a long test passphrase", false);
    await user.tab();
    await user.type(
      screen.getByLabelText("Password", { exact: true }),
      "changed",
    );
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });
  it("allows keyboard users to reveal passwords without losing their values", async () => {
    const { user } = setup();
    await fill(user, "a long test passphrase", false);
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
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(result, "owner@example.com"),
    );
    expect(register.mock.calls[0]?.[0]).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      verificationCode: "123456",
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
      await screen.findByText(
        "Too many registration attempts. Please wait and try again.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
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
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
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
  it("sends a code before allowing account creation and clears proof when email changes", async () => {
    const { user } = setup();
    await fill(user);
    expect(sendCode).toHaveBeenCalledWith("owner@example.com", undefined);
    expect(register).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.clear(screen.getByLabelText("Email address"));
    await user.type(screen.getByLabelText("Email address"), "new@example.com");
    expect(
      screen.queryByLabelText("Email verification code"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeEnabled();
  });
  it("preserves details and explains email delivery failure without creating an account", async () => {
    sendCode.mockRejectedValueOnce(new Error("private provider diagnostic"));
    const { user } = setup();
    await fill(user, "a long test passphrase", false);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not send your verification code",
    );
    expect(screen.getByLabelText("First name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue(
      "a long test passphrase",
    );
    expect(register).not.toHaveBeenCalled();
  });
  it("rejects a missing verification code locally", async () => {
    const { user } = setup();
    await fill(user);
    await user.clear(screen.getByLabelText("Email verification code"));
    await user.click(
      screen.getByRole("button", { name: /verify email and create account/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the verification code",
    );
    expect(register).not.toHaveBeenCalled();
  });
  it.each([
    [
      503,
      "EMAIL_DELIVERY_NOT_CONFIGURED",
      "Email sign-up is unavailable because verification email delivery has not been configured. Please contact support.",
    ],
    [
      429,
      "EMAIL_RATE_LIMITED",
      "Verification email requests have reached the sending limit. Please wait before requesting another code.",
    ],
  ])(
    "shows actionable email delivery feedback for %s %s",
    async (status, code, message) => {
      const error = new AxiosError("Provider failure");
      error.response = {
        status,
        statusText: "Failure",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { code, message },
      };
      sendCode.mockRejectedValueOnce(error);
      const { user } = setup();
      await fill(user, "a long test passphrase", false);
      await user.click(screen.getByRole("button", { name: "Create account" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(register).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Email address")).toHaveValue(
        "Owner@Example.com",
      );
    },
  );
  it("opens verification above the page, focuses the code and restores focus without losing details", async () => {
    const { user } = setup();
    await fill(user, "a long test passphrase", false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Verify your email",
    });
    expect(
      within(dialog).getByLabelText("Email verification code"),
    ).toHaveFocus();
    expect(dialog).toHaveTextContent("Owner@Example.com");
    await user.type(
      within(dialog).getByLabelText("Email verification code"),
      "123456",
    );
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Continue verification" }),
    ).toHaveFocus();
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue(
      "a long test passphrase",
    );
    await user.click(
      screen.getByRole("button", { name: "Continue verification" }),
    );
    expect(await screen.findByLabelText("Email verification code")).toHaveValue(
      "123456",
    );
    expect(sendCode).toHaveBeenCalledTimes(1);
    expect(register).not.toHaveBeenCalled();
  });
  it("resends from the modal without resetting the account form or registering", async () => {
    const { user } = setup();
    await fill(user);
    await user.click(
      screen.getByRole("button", { name: "Request a new code" }),
    );
    await waitFor(() => expect(sendCode).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("dialog", { name: "Verify your email" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email verification code")).toHaveValue("");
    expect(screen.getByLabelText("Email verification code")).toHaveFocus();
    expect(register).not.toHaveBeenCalled();
  });
  it("keeps errors inside the modal and prevents closing or duplicate submissions while verification is pending", async () => {
    const { user } = setup();
    await fill(user);
    const error = new AxiosError("Invalid code");
    error.response = {
      status: 400,
      statusText: "Bad request",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {
        code: "INVALID_VERIFICATION_CODE",
        message: "The code is incorrect or expired.",
      },
    };
    register.mockRejectedValueOnce(error);
    await user.click(
      screen.getByRole("button", { name: "Verify email and create account" }),
    );
    expect(
      await within(screen.getByRole("dialog")).findByRole("alert"),
    ).toHaveTextContent("incorrect or expired");
    expect(screen.getByRole("alert")).toHaveFocus();
    let finish!: (value: { message: string }) => void;
    register.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(
      screen.getByRole("button", { name: "Verify email and create account" }),
    );
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(register).toHaveBeenCalledTimes(2);
    await act(async () => finish({ message: REGISTRATION_ACKNOWLEDGEMENT }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
