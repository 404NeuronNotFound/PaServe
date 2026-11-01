import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GoogleSignIn } from "./GoogleSignIn";
import { api } from "../../../lib/api/client";
import { googleAccount } from "../api/session";
vi.mock("../../../lib/api/client", () => ({
  api: { post: vi.fn() },
  AUTH_REQUEST_TIMEOUT_MS: 15000,
}));
vi.mock("../api/session", () => ({ googleAccount: vi.fn() }));
let callback: (response: { credential: string }) => void;
const initialize = vi.fn();
const renderButton = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "public-client");
  vi.mocked(api.post).mockResolvedValue({
    data: { nonce: "hashed-browser-nonce" },
  });
  initialize.mockImplementation((options) => {
    callback = options.callback;
  });
  vi.stubGlobal("google", { accounts: { id: { initialize, renderButton } } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("uses the server challenge in the Google button and exchanges a credential for a session", async () => {
  const onSuccess = vi.fn();
  const session = {
    user: {
      id: "local-user",
      email: "owner@gmail.com",
      createdAt: "2026-11-01",
    },
    accessToken: "access",
    tokenType: "Bearer" as const,
    expiresIn: 900,
  };
  vi.mocked(googleAccount).mockResolvedValue(session);
  render(<GoogleSignIn keepSignedIn onSuccess={onSuccess} />);
  await waitFor(() => expect(renderButton).toHaveBeenCalled());
  expect(initialize).toHaveBeenCalledWith(
    expect.objectContaining({
      client_id: "public-client",
      nonce: "hashed-browser-nonce",
      auto_select: false,
    }),
  );
  await act(async () => callback({ credential: "google-credential" }));
  expect(googleAccount).toHaveBeenCalledWith({
    credential: "google-credential",
    keepSignedIn: true,
  });
  expect(onSuccess).toHaveBeenCalledWith(session);
});
it("requires names for Google registration without requiring an email password", async () => {
  const view = render(
    <GoogleSignIn
      names={{ firstName: "", lastName: "" }}
      onSuccess={vi.fn()}
    />,
  );
  await waitFor(() => expect(renderButton).toHaveBeenCalled());
  await act(async () => callback({ credential: "token" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter your first and last names",
  );
  expect(googleAccount).not.toHaveBeenCalled();
  view.rerender(
    <GoogleSignIn
      names={{ firstName: " Ada ", lastName: " Lovelace " }}
      onSuccess={vi.fn()}
    />,
  );
  vi.mocked(googleAccount).mockRejectedValue(
    new Error("private provider data"),
  );
  await act(async () => callback({ credential: "token" }));
  expect(googleAccount).toHaveBeenCalledWith({
    credential: "token",
    firstName: "Ada",
    lastName: "Lovelace",
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Google sign-in failed");
  expect(screen.queryByText("private provider data")).not.toBeInTheDocument();
});
it("does not load Google when the provider has not been configured", () => {
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
  render(<GoogleSignIn onSuccess={vi.fn()} />);
  expect(api.post).not.toHaveBeenCalled();
  expect(renderButton).not.toHaveBeenCalled();
});
