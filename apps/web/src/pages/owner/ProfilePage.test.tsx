import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import { ProfilePage } from "./ProfilePage";
import { NavigationProtection } from "../../app/router/NavigationProtection";
import { api } from "../../lib/api/client";
import { currentUserKey } from "../../features/auth/api/session";
import { useSessionStore } from "../../features/auth/stores/session";

const showModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const close = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (showModal)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModal);
  else
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>)
      .showModal;
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  useSessionStore.getState().setAccessToken(null);
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  useSessionStore.getState().setAccessToken("test-token");
  client.setQueryData(currentUserKey, {
    user: {
      id: "user",
      email: "lia@example.com",
      firstName: "Lia",
      lastName: "Navarro",
      createdAt: "2026-10-08T00:00:00Z",
      memberships: [],
    },
  });
  client.setQueryData(["private-records"], { value: "private" });
  const router = createMemoryRouter(
    [
      {
        path: "/app/account/profile",
        element: (
          <NavigationProtection>
            <ProfilePage />
          </NavigationProtection>
        ),
      },
      { path: "/app/account", element: <h1>Account overview</h1> },
      { path: "/login", element: <h1>Sign in</h1> },
    ],
    { initialEntries: ["/app/account/profile"] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router, user: userEvent.setup() };
}

it("saves personal details with bearer authentication and updates account identity", async () => {
  const patch = vi
    .spyOn(api, "patch")
    .mockResolvedValue({ data: { firstName: "Maria", lastName: "Navarro" } });
  const { user, client } = setup();
  await user.clear(screen.getByLabelText("First name"));
  await user.type(screen.getByLabelText("First name"), "Maria");
  await user.click(screen.getByRole("button", { name: "Save details" }));
  expect(await screen.findByText("Your details are saved.")).toBeVisible();
  expect(patch).toHaveBeenCalledWith(
    "/auth/profile",
    { firstName: "Maria", lastName: "Navarro" },
    expect.objectContaining({
      headers: {
        "X-PaServe-Client": "web",
        Authorization: "Bearer test-token",
      },
    }),
  );
  expect(client.getQueryData(currentUserKey)).toMatchObject({
    user: { firstName: "Maria" },
  });
  expect(screen.getAllByText("Maria Navarro")).toHaveLength(2);
});

it("blocks mismatched passwords and leaves the account signed in", async () => {
  const post = vi.spyOn(api, "post");
  const { user } = setup();
  await user.click(screen.getByRole("tab", { name: "Password" }));
  await user.type(
    screen.getByLabelText("Current password", { exact: true }),
    "current-passphrase",
  );
  await user.type(
    screen.getByLabelText("New password", { exact: true }),
    "a new long password",
  );
  await user.type(
    screen.getByLabelText("Confirm new password", { exact: true }),
    "another long password",
  );
  await user.click(screen.getByRole("button", { name: "Update password" }));
  expect(await screen.findByText("Passwords do not match.")).toBeVisible();
  expect(post).not.toHaveBeenCalled();
  expect(useSessionStore.getState().accessToken).toBe("test-token");
});

it("shows current-password errors without losing drafts or clearing the session", async () => {
  const error = new AxiosError("Bad request");
  error.response = {
    status: 400,
    statusText: "Bad request",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {
      message: "Your current password is incorrect.",
      fieldErrors: { currentPassword: ["Your current password is incorrect."] },
    },
  };
  vi.spyOn(api, "post").mockRejectedValue(error);
  const { user } = setup();
  await user.click(screen.getByRole("tab", { name: "Sign-in email" }));
  await user.clear(screen.getByLabelText("Email address"));
  await user.type(screen.getByLabelText("Email address"), "new@example.com");
  await user.type(
    screen.getByLabelText("Current password for email change", { exact: true }),
    "incorrect-password",
  );
  await user.click(screen.getByRole("button", { name: "Update email" }));
  await waitFor(() =>
    expect(
      screen.getByLabelText("Current password for email change", {
        exact: true,
      }),
    ).toHaveAttribute("aria-invalid", "true"),
  );
  expect(screen.getByLabelText("Email address")).toHaveValue("new@example.com");
  expect(useSessionStore.getState().accessToken).toBe("test-token");
});

it.each(["email", "password"] as const)(
  "clears private data and releases the navigation guard after changing %s",
  async (kind) => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ status: 204 });
    const { user, client, router } = setup();
    await user.click(
      screen.getByRole("tab", {
        name: kind === "email" ? "Sign-in email" : "Password",
      }),
    );
    if (kind === "email") {
      await user.clear(screen.getByLabelText("Email address"));
      await user.type(
        screen.getByLabelText("Email address"),
        "new@example.com",
      );
      await user.type(
        screen.getByLabelText("Current password for email change", {
          exact: true,
        }),
        "current-passphrase",
      );
    } else {
      await user.type(
        screen.getByLabelText("Current password", { exact: true }),
        "current-passphrase",
      );
      await user.type(
        screen.getByLabelText("New password", { exact: true }),
        "a new long password",
      );
      await user.type(
        screen.getByLabelText("Confirm new password", { exact: true }),
        "a new long password",
      );
    }
    await user.click(
      screen.getByRole("button", {
        name: kind === "email" ? "Update email" : "Update password",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeVisible();
    expect(post).toHaveBeenCalledWith(
      `/auth/${kind}`,
      expect.objectContaining({ currentPassword: "current-passphrase" }),
      expect.objectContaining({
        headers: {
          "X-PaServe-Client": "web",
          Authorization: "Bearer test-token",
        },
      }),
    );
    expect(router.state.location.pathname).toBe("/login");
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(useSessionStore.getState().accessToken).toBeNull();
  },
);

it("keeps drafts when switching editors and supports keyboard section navigation", async () => {
  const { user } = setup();
  expect(
    screen.getByRole("tabpanel", { name: "Personal details" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("tabpanel", { name: "Password" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("First name"), " draft");
  await user.click(screen.getByRole("tab", { name: "Sign-in email" }));
  await user.clear(screen.getByLabelText("Email address"));
  await user.type(screen.getByLabelText("Email address"), "draft@example.com");
  await user.click(screen.getByRole("tab", { name: "Personal details" }));
  expect(screen.getByLabelText("First name")).toHaveValue("Lia draft");
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("tab", { name: "Sign-in email" })).toHaveFocus();
  expect(screen.getByLabelText("Email address")).toHaveValue(
    "draft@example.com",
  );
});

it("protects unsaved details when using the sidebar", async () => {
  const { user } = setup();
  await user.type(screen.getByLabelText("First name"), " draft");
  await user.click(
    within(
      screen.getByRole("navigation", { name: "Account navigation" }),
    ).getByRole("link", { name: "Overview" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Leave this page?" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("First name")).toHaveValue("Lia draft");
});
