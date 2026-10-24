import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import { AuthEntryRoute } from "./AuthEntryRoute";
import { currentUserKey, getCurrentUser } from "../api/session";

vi.mock("../api/session", () => ({
  currentUserKey: ["auth", "me"],
  getCurrentUser: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
const profile = {
  user: {
    id: "user",
    email: "owner@example.com",
    firstName: null,
    lastName: null,
    createdAt: "2026-10-08",
    memberships: [],
  },
};
function setup(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthEntryRoute>
                <h1>Sign in form</h1>
              </AuthEntryRoute>
            }
          />
          <Route path="/app" element={<h1>Restored account</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("waits for server verification even with a cached account", async () => {
  let resolve!: (value: typeof profile) => void;
  vi.mocked(getCurrentUser).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const client = new QueryClient();
  client.setQueryData(currentUserKey, profile);
  setup(client);
  expect(screen.getByText("Restoring your session…")).toBeInTheDocument();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  resolve(profile);
  expect(
    await screen.findByRole("heading", { name: "Restored account" }),
  ).toBeVisible();
});
it("shows credentials only when the session is missing or expired", async () => {
  const error = new AxiosError("Expired");
  error.response = {
    status: 401,
    statusText: "Unauthorized",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  };
  vi.mocked(getCurrentUser).mockRejectedValue(error);
  setup();
  expect(
    await screen.findByRole("heading", { name: "Sign in form" }),
  ).toBeVisible();
});
it("offers retry after a connection failure without claiming the session ended", async () => {
  vi.mocked(getCurrentUser)
    .mockRejectedValueOnce(new Error("Network error"))
    .mockResolvedValueOnce(profile);
  setup();
  expect(
    await screen.findByRole("heading", {
      name: "Unable to restore your session",
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Sign in form" }),
  ).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Restored account" }),
  ).toBeVisible();
});
