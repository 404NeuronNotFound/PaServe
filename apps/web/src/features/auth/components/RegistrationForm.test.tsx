import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import { RegistrationForm } from "./RegistrationForm";
import { registerAccount, requestEmailCode } from "../api/register";
import { REGISTRATION_ACKNOWLEDGEMENT } from "@paserve/contracts";
vi.mock("../api/register", () => ({
  registerAccount: vi.fn(),
  requestEmailCode: vi.fn(),
}));
vi.mock("./GoogleSignIn", () => ({
  GoogleSignIn: () => <div>Google identity verification</div>,
}));
const register = vi.mocked(registerAccount);
const sendCode = vi.mocked(requestEmailCode);
const passphrase = "a long test passphrase";
const policy = {
  policyVersion: "2026-11-02",
  adultConfirmed: true,
  termsAccepted: true,
  privacyAcknowledged: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  sendCode.mockResolvedValue({ message: "Check your inbox." });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function setup(google = false) {
  const success = vi.fn();
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <RegistrationForm
          onSuccess={success}
          onGoogleSuccess={google ? vi.fn() : undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), success };
}
async function details(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("First name"), "Ada");
  await user.type(screen.getByLabelText("Last name"), "Lovelace");
  await user.type(screen.getByLabelText("Email address"), "Owner@Example.com");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}
async function ready(user: ReturnType<typeof userEvent.setup>, accept = true) {
  await details(user);
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    passphrase,
  );
  await user.type(screen.getByLabelText("Confirm password"), passphrase);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  if (accept)
    for (const checkbox of screen.getAllByRole("checkbox"))
      await user.click(checkbox);
}
async function verification(user: ReturnType<typeof userEvent.setup>) {
  await ready(user);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await user.type(
    await screen.findByLabelText("Email verification code"),
    "123456",
  );
}
function apiError(
  code: string,
  message: string,
  status = 400,
  fieldErrors?: Record<string, string[]>,
) {
  const error = new AxiosError("private diagnostic");
  error.response = {
    status,
    statusText: "Failure",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { code, message, fieldErrors },
  };
  return error;
}
it("renders only the current short step and preserves values and focus when navigating back", async () => {
  const { user } = setup();
  expect(screen.getByRole("heading", { name: "Your details" })).toHaveFocus();
  expect(
    screen.queryByLabelText("Password", { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await details(user);
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Set a password" })).toHaveFocus();
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    passphrase,
  );
  await user.type(screen.getByLabelText("Confirm password"), passphrase);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    screen.queryByLabelText("Password", { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Password", { exact: true })).toHaveValue(
    passphrase,
  );
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Email address")).toHaveValue(
    "Owner@Example.com",
  );
  expect(sendCode).not.toHaveBeenCalled();
});
it("validates only the visible details before progressing", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  expect(screen.queryByText("Confirm your password.")).not.toBeInTheDocument();
  expect(screen.getByLabelText("First name")).toHaveFocus();
  expect(sendCode).not.toHaveBeenCalled();
});
it("validates visited fields while correcting email", async () => {
  const { user } = setup();
  await user.type(screen.getByLabelText("Email address"), "wrong");
  expect(
    screen.queryByText("Enter a valid email address."),
  ).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Email address"), "@example.com");
  expect(
    screen.queryByText("Enter a valid email address."),
  ).not.toBeInTheDocument();
});
it("blocks mismatched passwords and supports keyboard password visibility", async () => {
  const { user } = setup();
  await details(user);
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    passphrase,
  );
  await user.type(
    screen.getByLabelText("Confirm password"),
    "different password",
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  screen.getByRole("button", { name: "Show passwords" }).focus();
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  expect(screen.getByRole("button", { name: "Hide passwords" })).toHaveFocus();
  expect(sendCode).not.toHaveBeenCalled();
});
it.each([0, 1, 2])(
  "requires every unchecked declaration before email (%s)",
  async (unchecked) => {
    const { user } = setup();
    await ready(user, false);
    const checkboxes = screen.getAllByRole("checkbox");
    for (const checkbox of checkboxes) expect(checkbox).not.toBeChecked();
    for (let i = 0; i < checkboxes.length; i++)
      if (i !== unchecked) await user.click(checkboxes[i]);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Confirm you are 18 or older",
    );
    expect(sendCode).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: /Terms of Service/ }),
    ).toHaveAttribute("target", "_blank");
  },
);
it("offers a Google path without requiring email or a password", async () => {
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client");
  const { user } = setup(true);
  await user.type(screen.getByLabelText("First name"), "Ada");
  await user.type(screen.getByLabelText("Last name"), "Lovelace");
  await user.click(screen.getByRole("button", { name: "Use Google instead" }));
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(
    screen.queryByLabelText("Password", { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Google identity verification")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create account" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("First name")).toHaveValue("Ada");
  expect(sendCode).not.toHaveBeenCalled();
});
it("requests verification then submits the normalized account with declarations", async () => {
  register.mockResolvedValue({ message: REGISTRATION_ACKNOWLEDGEMENT });
  const { user, success } = setup();
  await verification(user);
  expect(sendCode).toHaveBeenCalledWith("owner@example.com", policy, undefined);
  expect(register).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  await waitFor(() =>
    expect(success).toHaveBeenCalledWith(
      { message: REGISTRATION_ACKNOWLEDGEMENT },
      "owner@example.com",
    ),
  );
  expect(register.mock.calls[0]?.[0]).toEqual({
    ...policy,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "owner@example.com",
    password: passphrase,
    verificationCode: "123456",
  });
  expect(screen.getByLabelText("First name")).toHaveValue("");
});
it("keeps the verification code in a modal and restores focus on dismissal", async () => {
  const { user } = setup();
  await verification(user);
  const dialog = screen.getByRole("dialog", { name: "Verify your email" });
  expect(
    within(dialog).getByLabelText("Email verification code"),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: "Continue verification" }),
  ).toHaveFocus();
  await user.click(
    screen.getByRole("button", { name: "Continue verification" }),
  );
  expect(await screen.findByLabelText("Email verification code")).toHaveValue(
    "123456",
  );
  expect(sendCode).toHaveBeenCalledTimes(1);
});
it("returns to details for editing and invalidates proof when email changes", async () => {
  const { user } = setup();
  await verification(user);
  await user.click(screen.getByRole("button", { name: "Edit details" }));
  expect(screen.getByLabelText("Email address")).toHaveValue(
    "Owner@Example.com",
  );
  await user.clear(screen.getByLabelText("Email address"));
  await user.type(screen.getByLabelText("Email address"), "new@example.com");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(sendCode).toHaveBeenLastCalledWith(
    "new@example.com",
    policy,
    undefined,
  );
  expect(screen.getByLabelText("Email verification code")).toHaveValue("");
});
it("resends in the modal without registering or losing the draft", async () => {
  const { user } = setup();
  await verification(user);
  await user.click(screen.getByRole("button", { name: "Request a new code" }));
  await waitFor(() => expect(sendCode).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Email verification code")).toHaveValue("");
  expect(screen.getByLabelText("Email verification code")).toHaveFocus();
  expect(register).not.toHaveBeenCalled();
});
it("rejects an empty verification code locally", async () => {
  const { user } = setup();
  await verification(user);
  await user.clear(screen.getByLabelText("Email verification code"));
  await user.click(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter the verification code",
  );
  expect(register).not.toHaveBeenCalled();
});
it("keeps server errors in the modal and blocks dismissal and duplicate submissions while pending", async () => {
  const { user } = setup();
  await verification(user);
  register.mockRejectedValueOnce(
    apiError("INVALID_VERIFICATION_CODE", "The code is incorrect or expired."),
  );
  await user.click(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  expect(
    await within(screen.getByRole("dialog")).findByRole("alert"),
  ).toHaveTextContent("incorrect or expired");
  let finish!: (value: { message: string }) => void;
  register.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.dblClick(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(register).toHaveBeenCalledTimes(2);
  await act(async () => finish({ message: REGISTRATION_ACKNOWLEDGEMENT }));
});
it.each([
  [503, "EMAIL_DELIVERY_NOT_CONFIGURED"],
  [429, "EMAIL_RATE_LIMITED"],
])("preserves navigation and delivery feedback (%s)", async (status, code) => {
  sendCode.mockRejectedValueOnce(
    apiError(
      code as string,
      "Delivery unavailable. Try later.",
      status as number,
    ),
  );
  const { user } = setup();
  await ready(user);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Delivery unavailable. Try later.",
  );
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Password", { exact: true })).toHaveValue(
    passphrase,
  );
  expect(register).not.toHaveBeenCalled();
});
it("explains an unknown creation outcome without automatically retrying", async () => {
  register.mockRejectedValueOnce(
    new AxiosError("private diagnostic", "ERR_NETWORK"),
  );
  const { user } = setup();
  await verification(user);
  await user.click(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "try signing in with these details before registering again",
  );
  expect(register).toHaveBeenCalledTimes(1);
});
it("routes invalid server fields back to their step", async () => {
  register.mockRejectedValueOnce(
    apiError("VALIDATION_ERROR", "Check details", 400, {
      email: ["Enter a valid email address."],
    }),
  );
  const { user } = setup();
  await verification(user);
  await user.click(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Email address")).toHaveValue(
    "Owner@Example.com",
  );
});
it("requires review when the server policy has changed", async () => {
  register.mockRejectedValueOnce(
    apiError("VALIDATION_ERROR", "Policy changed", 400, {
      policyVersion: ["Review current policies."],
    }),
  );
  const { user } = setup();
  await verification(user);
  await user.click(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Registration requirements have changed",
  );
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
});
it("preserves the step flow while escalating a server-requested security challenge", async () => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-key");
  let options!: Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
  vi.stubGlobal("turnstile", {
    render: vi.fn((_element, value) => {
      options = value;
      return "widget";
    }),
    remove: vi.fn(),
  });
  register
    .mockRejectedValueOnce(
      apiError("BOT_CHALLENGE_REQUIRED", "Verify request", 403),
    )
    .mockResolvedValueOnce({ message: REGISTRATION_ACKNOWLEDGEMENT });
  const { user, success } = setup();
  await verification(user);
  await user.click(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  await waitFor(() => expect(options).toBeDefined());
  expect(
    screen.getByRole("button", { name: "Verify email and create account" }),
  ).toBeDisabled();
  act(() => options.callback("proof"));
  await user.click(
    screen.getByRole("button", { name: "Verify email and create account" }),
  );
  await waitFor(() => expect(success).toHaveBeenCalled());
  expect(register.mock.calls.at(-1)?.[0]).toMatchObject({
    challengeToken: "proof",
  });
});
