import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { ProtectedRoute } from "./ProtectedRoute";
import { getCurrentUser } from "../api/session";

vi.mock("../api/session", () => ({
  currentUserKey: ["auth", "me"],
  getCurrentUser: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
});
function renderRoute(
  client = new QueryClient(),
  path = "/app/account",
  children: ReactNode = <h1>Private account</h1>,
) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route
            path={path}
            element={<ProtectedRoute>{children}</ProtectedRoute>}
          />
          <Route path="/login" element={<h1>Sign in</h1>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it("renders the protected page only after the server verifies the session", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    user: {
      id: "user-id",
      email: "owner@example.com",
      createdAt: "2026-10-08T00:00:00Z",
      firstName: null,
      lastName: null,
      memberships: [],
    },
  });
  renderRoute();
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
  expect(
    document.querySelector('.loading-skeleton [aria-busy="true"]'),
  ).not.toBeNull();
  expect(await screen.findByText("Private account")).toBeInTheDocument();
  expect(document.querySelector(".loading-skeleton")).toBeNull();
});

function DraftWorkspace() {
  const [draft, setDraft] = useState("");
  return (
    <label>
      Unsaved draft
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
    </label>
  );
}
it.each([
  "/app/account/profile",
  "/app/account/notifications",
  "/app/shops/shop-a/settings",
  "/app/shops/shop-a/products",
  "/app/shops/shop-a/staff",
  "/app/shops/shop-a/orders",
  "/app/shops/shop-a/sales",
  "/app/shops/shop-a/kitchen",
  "/app/shops/shop-a/cashier",
])(
  "preserves the mounted workspace on tab return and reconnect at %s",
  async (path) => {
    vi.mocked(getCurrentUser)
      .mockResolvedValueOnce({
        user: {
          id: "user-id",
          email: "owner@example.com",
          createdAt: "2026-10-08T00:00:00Z",
          firstName: null,
          lastName: null,
          memberships: [],
        },
      })
      .mockRejectedValue(new Error("background connection unavailable"));
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    try {
      renderRoute(new QueryClient(), path, <DraftWorkspace />);
      const draft = await screen.findByLabelText("Unsaved draft");
      fireEvent.change(draft, { target: { value: "Keep this work" } });
      await act(async () => {
        focusManager.setFocused(false);
        onlineManager.setOnline(false);
      });
      await act(async () => {
        focusManager.setFocused(true);
        onlineManager.setOnline(true);
      });
      expect(screen.getByLabelText("Unsaved draft")).toBe(draft);
      expect(draft).toHaveValue("Keep this work");
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText("Unable to check your session"),
      ).not.toBeInTheDocument();
    } finally {
      cleanup();
      focusManager.setFocused(undefined);
      onlineManager.setOnline(true);
    }
  },
);

it("redirects unauthenticated visitors to sign in", async () => {
  const error = new AxiosError("Unauthorized");
  error.response = {
    status: 401,
    statusText: "Unauthorized",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  };
  vi.mocked(getCurrentUser).mockRejectedValue(error);
  renderRoute();
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
});

it("shows a retry action for network failure instead of pretending the user signed out", async () => {
  vi.mocked(getCurrentUser).mockRejectedValue(new Error("network unavailable"));
  renderRoute();
  expect(
    await screen.findByRole("button", { name: "Try again" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
});

it("does not expose a private page from a cached profile while rechecking a revoked session", async () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "me"], { user: { id: "previous-user" } });
  vi.mocked(getCurrentUser).mockRejectedValue(
    new Error("session check failed"),
  );
  renderRoute(client, "/app/shops/shop-a/cashier");
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
  expect(
    document.querySelector(".loading-skeleton .skeleton-access-camera"),
  ).not.toBeNull();
  expect(
    await screen.findByRole("button", { name: "Try again" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private account")).not.toBeInTheDocument();
});
