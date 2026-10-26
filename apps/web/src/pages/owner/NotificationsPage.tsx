import { ListPagination } from "../../components/paserve/ListPagination";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FiBell, FiCheck, FiMail, FiShield, FiUserMinus } from "react-icons/fi";
import type {
  AccountNotification,
  CurrentUserResponse,
} from "@paserve/contracts";
import { AccountFrame } from "../../components/layout/AccountFrame";
import { Button } from "../../components/ui/button";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { RefreshButton } from "../../components/feedback/RefreshButton";
import { NotificationsSkeleton } from "../../components/feedback/LoadingSkeleton";
import { feedback } from "../../app/stores/feedback";
import {
  currentUserKey,
  getCurrentUser,
} from "../../features/auth/api/session";
import { shopPath } from "../../features/shops/active-shop";
import {
  useNotifications,
  notificationKey,
  markNotificationsRead,
  respondToInvitation,
} from "../../features/account/notifications";
import "./notifications.css";

const roleName = (role: string | null) =>
  role === "KITCHEN"
    ? "Kitchen / barista"
    : role
      ? role[0] + role.slice(1).toLowerCase()
      : "Staff";
function content(n: AccountNotification) {
  switch (n.kind) {
    case "INVITED":
      return {
        title: "You’re invited",
        text: `${n.actorName} invited you to join ${n.shopName} as ${roleName(n.role)}.`,
        icon: FiMail,
      };
    case "ROLE_CHANGED":
      return {
        title: "Your role changed",
        text: `Your role at ${n.shopName} changed from ${roleName(n.previousRole)} to ${roleName(n.role)}.`,
        icon: FiShield,
      };
    case "ENABLED":
      return {
        title: "Shop access restored",
        text: `${n.actorName} restored your access to ${n.shopName} as ${roleName(n.role)}.`,
        icon: FiCheck,
      };
    case "DISABLED":
      return {
        title: "Shop access suspended",
        text: `Your access to ${n.shopName} has been suspended. Contact the shop owner for help.`,
        icon: FiUserMinus,
      };
    case "REMOVED":
      return {
        title: "Shop access removed",
        text: `You no longer have access to ${n.shopName}.`,
        icon: FiUserMinus,
      };
    case "ACCEPTED":
      return {
        title: "Invitation accepted",
        text: `${n.actorName} accepted your invitation to ${n.shopName} as ${roleName(n.role)}.`,
        icon: FiCheck,
      };
    case "DECLINED":
      return {
        title: "Invitation declined",
        text: `${n.actorName} declined your invitation to ${n.shopName}.`,
        icon: FiMail,
      };
  }
}
export function NotificationsPage() {
  const client = useQueryClient();
  const user = client.getQueryData<CurrentUserResponse>(currentUserKey)?.user;
  const userId = user?.id ?? "";
  const [cursors, setCursors] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = "Notifications · PaServe";
    heading.current?.focus({ preventScroll: true });
  }, []);
  const query = useNotifications(userId, cursors.at(-1));
  const refresh = () =>
    client.invalidateQueries({ queryKey: notificationKey(userId) });
  const read = useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: refresh,
  });
  const response = useMutation({
    mutationFn: async ({
      n,
      action,
    }: {
      n: AccountNotification;
      action: "accept" | "decline";
    }) => {
      await respondToInvitation(n.shopId, n.invitation!.id, action);
      return action;
    },
    onSuccess: async (action, { n }) => {
      // A failed follow-up refresh must not misreport a committed decision.
      await Promise.allSettled([
        getCurrentUser().then((data) => {
          if (
            client.getQueryData<CurrentUserResponse>(currentUserKey)?.user
              .id === userId
          )
            client.setQueryData(currentUserKey, data);
        }),
        markNotificationsRead(n.id),
      ]);
      if (
        client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
        userId
      )
        feedback.toast(
          action === "accept" ? "Invitation accepted." : "Invitation declined.",
        );
    },
    onSettled: refresh,
  });
  const busy = read.isPending || response.isPending;
  const memberships =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user
      .memberships ?? [];
  return (
    <AccountFrame>
      <section
        className="account-notifications"
        aria-labelledby="notifications-heading"
      >
        <div className="notifications-heading">
          <div>
            <p className="section-label">YOUR ACCOUNT</p>
            <h1 id="notifications-heading" ref={heading} tabIndex={-1}>
              Notifications
            </h1>
            <p>Invitations and updates to your shop access.</p>
          </div>
          <RefreshButton
            label="Refresh notifications"
            pending={query.isFetching}
            onClick={() => {
              void refresh();
            }}
          />
        </div>
        <div className="notifications-toolbar">
          <span>
            {query.data ? `${query.data.unreadCount} unread` : "Your inbox"}
          </span>
          <Button
            variant="outline"
            disabled={busy || !query.data?.unreadCount}
            onClick={() => read.mutate(undefined)}
          >
            <FiCheck aria-hidden="true" /> Mark all as read
          </Button>
        </div>
        {(read.isError || response.isError) && (
          <InlineMessage>
            We couldn’t complete that action. Refresh to check the invitation
            and try again.
          </InlineMessage>
        )}
        {query.isPending && <NotificationsSkeleton />}
        {query.isError && (
          <InlineMessage>
            We couldn’t load your notifications. Please try refreshing.
          </InlineMessage>
        )}
        {query.data && (
          <>
            {!query.data.notifications.length && (
              <div className="notifications-empty">
                <FiBell aria-hidden="true" />
                <h2>You’re all caught up</h2>
                <p>
                  Your shop invitations and access updates will appear here.
                </p>
              </div>
            )}
            <ul className="notification-list">
              {query.data.notifications.map((n) => {
                const { title, text, icon: Icon } = content(n);
                const member = memberships.find(
                  (m) => m.shopId === n.shopId && m.shop.isActive,
                );
                return (
                  <li
                    key={n.id}
                    className="notification-card"
                    data-unread={!n.readAt}
                  >
                    <span className="notification-icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <div className="notification-content">
                      <div className="notification-title">
                        <h2>{title}</h2>
                        {!n.readAt && (
                          <span className="notification-unread">Unread</span>
                        )}
                      </div>
                      <p>{text}</p>
                      <time dateTime={n.createdAt}>
                        {new Date(n.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                      {n.invitation && (
                        <p className="notification-invitation-state">
                          {n.invitation.status === "PENDING"
                            ? `Expires ${new Date(n.invitation.expiresAt).toLocaleDateString()}`
                            : `Invitation ${n.invitation.status.toLowerCase()}`}
                        </p>
                      )}
                      <div className="notification-actions">
                        {n.invitation?.status === "PENDING" && (
                          <>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                response.mutate({ n, action: "accept" })
                              }
                            >
                              Accept invitation
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                response.mutate({ n, action: "decline" })
                              }
                            >
                              Decline
                            </Button>
                          </>
                        )}
                        {member &&
                          n.kind !== "REMOVED" &&
                          n.kind !== "DISABLED" && (
                            <Button asChild variant="outline">
                              <Link to={shopPath(n.shopId)}>View shop</Link>
                            </Button>
                          )}
                        {!n.readAt && (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => read.mutate(n.id)}
                          >
                            Mark as read
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {(cursors.length > 0 || query.data.nextCursor) && (
              <ListPagination label="Notification pages" className="notifications-pagination"
                page={cursors.length + 1} hasNext={Boolean(query.data.nextCursor)} pending={busy}
                previousLabel="Newer" nextLabel="Older"
                onPrevious={() => setCursors((c) => c.slice(0, -1))}
                onNext={() => setCursors((c) => [...c, query.data!.nextCursor!])} />
            )}
          </>
        )}
      </section>
    </AccountFrame>
  );
}
