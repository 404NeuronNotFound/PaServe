import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import { JoinShopPage } from "./JoinShopPage";
import { getCurrentUser, logoutAccount } from "../../features/auth/api/session";
import {
  acceptInvitation,
  previewInvitation,
} from "../../features/shops/api/staff";

vi.mock("../../features/auth/api/session", () => ({
  getCurrentUser: vi.fn(),
  logoutAccount: vi.fn(),
}));
vi.mock("../../features/shops/api/staff", () => ({
  acceptInvitation: vi.fn(),
  previewInvitation: vi.fn(),
}));
vi.mock("../../features/auth/components/LoginForm", () => ({
  LoginForm: ({
    onSuccess,
    initialEmail,
  }: {
    onSuccess: () => void;
    initialEmail?: string;
  }) => (
    <button onClick={onSuccess} data-email={initialEmail}>
      Sign in
    </button>
  ),
}));
vi.mock("../../features/auth/components/RegistrationForm", () => ({
  RegistrationForm: ({
    onSuccess,
  }: {
    onSuccess: (result: { user: { email: string } }) => void;
  }) => (
    <button onClick={() => onSuccess({ user: { email: "staff@example.com" } })}>
      Register account
    </button>
  ),
}));
const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
const token = "a".repeat(64);
const profile = {
  user: {
    id: "u",
    email: "staff@example.com",
    createdAt: "2026-10-13",
    firstName: null,
    lastName: null,
    memberships: [],
  },
};
function failure(status: number, message = "Invitation unavailable") {
  const error = new AxiosError(message);
  error.response = {
    status,
    statusText: "Error",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { message },
  };
  return error;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(profile);
  vi.mocked(previewInvitation).mockResolvedValue({
    shopId,
    shopName: "Cafe A",
    email: "staff@example.com",
    role: "CASHIER",
    expiresAt: "2026-10-20T00:00:00Z",
  });
});
function setup(hash = `#token=${token}`) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/join/${shopId}${hash}`]}>
        <Link to={`/join/${shopId}#token=${"b".repeat(64)}`}>
          Open another invitation
        </Link>
        <Routes>
          <Route path="/join/:shopId" element={<JoinShopPage />} />
          <Route
            path="/app/shops/:shopId/cashier"
            element={<h1>Cashier workspace</h1>}
          />
          <Route path="/app/shops/:shopId" element={<h1>Shop workspace</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("rejects an incomplete link without requesting a session", () => {
  setup("");
  expect(screen.getByText(/invitation link is incomplete/)).toBeInTheDocument();
  expect(getCurrentUser).not.toHaveBeenCalled();
});
it("accepts explicitly and routes a cashier to the assigned shop", async () => {
  vi.mocked(acceptInvitation).mockResolvedValue({ shopId, role: "CASHIER" });
  const user = setup();
  await screen.findByRole("button", { name: "Accept invitation" });
  expect(acceptInvitation).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Accept invitation" }));
  expect(acceptInvitation).toHaveBeenCalledWith(shopId, token);
  expect(
    await screen.findByRole("heading", { name: "Cashier workspace" }),
  ).toBeInTheDocument();
});
it("routes kitchen staff to the shop workspace", async () => {
  vi.mocked(acceptInvitation).mockResolvedValue({ shopId, role: "KITCHEN" });
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Accept invitation" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Shop workspace" }),
  ).toBeInTheDocument();
});
it.each([403, 404, 409])(
  "retains the invitation and shows a server denial (%s)",
  async (status) => {
    vi.mocked(acceptInvitation).mockRejectedValue(failure(status));
    const user = setup();
    await user.click(
      await screen.findByRole("button", { name: "Accept invitation" }),
    );
    expect(
      await screen.findByText("Invitation unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cashier workspace" }),
    ).not.toBeInTheDocument();
  },
);
it("lets a new user register, sign in, and accept without shop creation", async () => {
  vi.mocked(getCurrentUser)
    .mockRejectedValueOnce(failure(401))
    .mockResolvedValue(profile);
  vi.mocked(acceptInvitation).mockResolvedValue({ shopId, role: "CASHIER" });
  const user = setup();
  await user.click(
    await screen.findByRole("button", {
      name: "New to PaServe? Create an account",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Register account" }));
  expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute(
    "data-email",
    "staff@example.com",
  );
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await user.click(
    await screen.findByRole("button", { name: "Accept invitation" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Cashier workspace" }),
  ).toBeInTheDocument();
});
it("offers a retry when session verification fails", async () => {
  vi.mocked(getCurrentUser)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(profile);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("button", { name: "Accept invitation" }),
  ).toBeInTheDocument();
});

it("shows the verified shop and role before granting access", async () => {
  setup();
  expect(await screen.findByText("Cafe A")).toBeInTheDocument();
  expect(screen.getByText("cashier")).toBeInTheDocument();
  expect(acceptInvitation).not.toHaveBeenCalled();
});

it("blocks acceptance if invitation preview is denied", async () => {
  vi.mocked(previewInvitation).mockRejectedValue(
    failure(403, "Use the invited email address"),
  );
  setup();
  expect(
    await screen.findByText("Use the invited email address"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Accept invitation" }),
  ).toBeDisabled();
  expect(acceptInvitation).not.toHaveBeenCalled();
});
it("permits switching accounts on the invitation page", async () => {
  vi.mocked(getCurrentUser)
    .mockResolvedValueOnce(profile)
    .mockRejectedValueOnce(failure(401));
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Use another account" }),
  );
  expect(logoutAccount).toHaveBeenCalled();
  expect(
    await screen.findByRole("button", { name: "Sign in" }),
  ).toBeInTheDocument();
});

it("does not reuse another link's preview while checking a new invitation", async () => {
  const user = setup();
  await screen.findByText("Cafe A");
  vi.mocked(previewInvitation).mockImplementation(() => new Promise(() => {}));
  await user.click(
    screen.getByRole("link", { name: "Open another invitation" }),
  );
  expect(screen.queryByText("Cafe A")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Accept invitation" }),
  ).toBeDisabled();
  expect(acceptInvitation).not.toHaveBeenCalled();
});
