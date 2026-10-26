import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { AccountNotification } from "@paserve/contracts";
import { NotificationsPage } from "./NotificationsPage";
import { api } from "../../lib/api/client";
import { currentUserKey } from "../../features/auth/api/session";
import { useSessionStore } from "../../features/auth/stores/session";

const notice: AccountNotification = {
  id: "notice-1",
  kind: "INVITED",
  shopId: "shop-1",
  shopName: "Hiraya",
  actorName: "Lia Navarro",
  role: "CASHIER",
  previousRole: null,
  createdAt: "2026-10-26T08:00:00Z",
  readAt: null,
  invitation: {
    id: "invite-1",
    status: "PENDING",
    expiresAt: "2026-11-02T08:00:00Z",
  },
};
const user = {
  id: "recipient",
  email: "recipient@example.com",
  memberships: [],
};
let notices: AccountNotification[];
beforeEach(() => {
  vi.restoreAllMocks();
  notices = [structuredClone(notice)];
  useSessionStore.getState().setAccessToken("test-token");
});
afterEach(() => {
  useSessionStore.getState().setAccessToken(null);
});
function setup(unreadCount?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.spyOn(api, "get").mockImplementation(async (url) => ({
    data:
      url === "/auth/me"
        ? { user }
        : {
            notifications: notices,
            unreadCount: unreadCount ?? notices.filter((n) => !n.readAt).length,
            nextCursor: null,
          },
  }));
  const patch = vi.spyOn(api, "patch").mockImplementation(async () => {
    notices = notices.map((n) => ({ ...n, readAt: new Date().toISOString() }));
    return { status: 204 };
  });
  client.setQueryData(currentUserKey, { user });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/account/notifications"]}>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, patch, actor: userEvent.setup() };
}
it("shows an accessible unread count and caps the red badge at 99+", async () => {
  setup(120);
  const bell = await screen.findByRole("link", {
    name: "Notifications, 120 unread",
  });
  expect(within(bell).getByText("99+")).toBeInTheDocument();
  expect(
    screen.getByText("Lia Navarro invited you to join Hiraya as Cashier."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Notifications", current: "page" }),
  ).toBeInTheDocument();
});
it("marking everything read clears the count and keeps the pending invitation actionable", async () => {
  const { actor, patch } = setup();
  await screen.findByRole("button", { name: "Accept invitation" });
  await actor.click(screen.getByRole("button", { name: "Mark all as read" }));
  await screen.findByRole("link", { name: "Notifications, 0 unread" });
  expect(patch).toHaveBeenCalledWith("/account/notifications/read");
  expect(
    screen.getByRole("button", { name: "Accept invitation" }),
  ).toBeEnabled();
});
it.each(["accept", "decline"] as const)(
  "responds to an invitation with %s and disables repeat actions while pending",
  async (action) => {
    let complete!: (result: unknown) => void;
    const post = vi.spyOn(api, "post").mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { actor } = setup();
    await actor.click(
      await screen.findByRole("button", {
        name: action === "accept" ? "Accept invitation" : "Decline",
      }),
    );
    expect(post).toHaveBeenCalledWith(
      `/account/notifications/invitations/shop-1/invite-1/${action}`,
    );
    expect(
      screen.getByRole("button", { name: "Accept invitation" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
    notices = notices.map((n) => ({
      ...n,
      invitation: {
        ...n.invitation!,
        status: action === "accept" ? "ACCEPTED" : "DECLINED",
      },
    }));
    complete({ data: { shopId: "shop-1", role: "CASHIER" } });
    await screen.findByText(
      `Invitation ${action === "accept" ? "accepted" : "declined"}`,
    );
    expect(
      screen.queryByRole("button", { name: "Accept invitation" }),
    ).not.toBeInTheDocument();
  },
);
it("keeps invitation controls on failure and provides contextual recovery", async () => {
  vi.spyOn(api, "post").mockRejectedValue(new Error("unavailable"));
  const { actor } = setup();
  await actor.click(await screen.findByRole("button", { name: "Decline" }));
  await screen.findByText(/couldn’t complete that action/);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled(),
  );
});
it.each(["DECLINED", "EXPIRED", "REVOKED", "ACCEPTED"] as const)(
  "does not offer actions for %s invitations",
  async (status) => {
    notices = [{ ...notice, invitation: { ...notice.invitation!, status } }];
    setup();
    await screen.findByText(`Invitation ${status.toLowerCase()}`);
    expect(
      screen.queryByRole("button", { name: "Accept invitation" }),
    ).not.toBeInTheDocument();
  },
);
it("shows access removal without a link back into the shop", async () => {
  notices = [{ ...notice, kind: "REMOVED", invitation: null }];
  setup();
  await screen.findByText("You no longer have access to Hiraya.");
  expect(
    screen.queryByRole("link", { name: "View shop" }),
  ).not.toBeInTheDocument();
});
it("notifies restored members with an unread badge and a link only for current membership", async () => {
  notices = [{ ...notice, kind: "ENABLED", invitation: null }];
  setup();
  expect(await screen.findByText("Shop access restored")).toBeInTheDocument();
  expect(screen.getByText("Lia Navarro restored your access to Hiraya as Cashier.")).toBeInTheDocument();
  expect(within(screen.getByRole("link", { name: "Notifications, 1 unread" })).getByText("1")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "View shop" })).not.toBeInTheDocument();
});
it("offers the shop link for a restoration notice when membership is active", async () => {
  notices = [{ ...notice, kind: "ENABLED", invitation: null }];
  const { client } = setup();
  client.setQueryData(currentUserKey, { user: { ...user, memberships: [{
    id: "member-1", shopId: "shop-1", role: "CASHIER",
    shop: { id: "shop-1", name: "Hiraya", slug: "hiraya", isActive: true },
  }] } });
  expect(await screen.findByRole("link", { name: "View shop" })).toHaveAttribute("href", "/app/shops/shop-1");
});
it("shows an empty inbox without a red badge", async () => {
  notices = [];
  setup();
  await screen.findByText("You’re all caught up");
  expect(
    screen
      .getByRole("link", { name: "Notifications, 0 unread" })
      .querySelector(".account-notification-count"),
  ).toBeNull();
});
