import { useQuery } from "@tanstack/react-query";
import type {
  AccountNotificationsResponse,
  AcceptStaffInvitationResponse,
} from "@paserve/contracts";
import { api } from "../../lib/api/client";
import "../auth/api/session";

export const notificationKey = (userId: string) =>
  ["account-notifications", userId] as const;
export function useNotifications(userId: string, cursor?: string) {
  return useQuery({
    queryKey: [...notificationKey(userId), cursor ?? "latest"],
    queryFn: async ({ signal }) =>
      (
        await api.get<AccountNotificationsResponse>("/account/notifications", {
          signal,
          params: cursor ? { cursor } : undefined,
        })
      ).data,
    enabled: Boolean(userId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
export async function markNotificationsRead(id?: string) {
  await api.patch(
    id
      ? `/account/notifications/${encodeURIComponent(id)}/read`
      : "/account/notifications/read",
  );
}
export async function respondToInvitation(
  shopId: string,
  id: string,
  action: "accept" | "decline",
) {
  const { data } = await api.post<AcceptStaffInvitationResponse | undefined>(
    `/account/notifications/invitations/${encodeURIComponent(shopId)}/${encodeURIComponent(id)}/${action}`,
  );
  return data;
}
