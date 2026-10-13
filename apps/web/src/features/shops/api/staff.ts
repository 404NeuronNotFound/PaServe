import type {
  AcceptStaffInvitationResponse,
  CreateStaffInvitationRequest,
  CreateStaffInvitationResponse,
  ShopStaffResponse,
  StaffRole,
  StaffInvitationPreview,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";

const base = (shopId: string) => `/shops/${encodeURIComponent(shopId)}/staff`;
export async function listStaff(shopId: string, signal?: AbortSignal) {
  const { data } = await api.get<ShopStaffResponse>(base(shopId), { signal });
  if (data.shopId !== shopId)
    throw new Error("Staff context could not be verified.");
  return data;
}
export async function inviteStaff(
  shopId: string,
  input: CreateStaffInvitationRequest,
) {
  const { data } = await api.post<CreateStaffInvitationResponse>(
    `${base(shopId)}/invitations`,
    input,
  );
  if (data.shopId !== shopId || !/^[0-9a-f]{64}$/.test(data.token))
    throw new Error("Invitation response could not be verified.");
  return data;
}
export async function revokeInvitation(shopId: string, id: string) {
  await api.delete(`${base(shopId)}/invitations/${encodeURIComponent(id)}`);
}
export async function changeStaffRole(
  shopId: string,
  id: string,
  role: StaffRole,
) {
  await api.patch(`${base(shopId)}/members/${encodeURIComponent(id)}`, {
    role,
  });
}
export async function removeStaff(shopId: string, id: string) {
  await api.delete(`${base(shopId)}/members/${encodeURIComponent(id)}`);
}
export async function acceptInvitation(shopId: string, token: string) {
  const { data } = await api.post<AcceptStaffInvitationResponse>(
    `/staff-invitations/${encodeURIComponent(shopId)}/accept`,
    { token },
  );
  if (
    data.shopId !== shopId ||
    !["ADMIN", "MANAGER", "CASHIER", "KITCHEN"].includes(data.role)
  )
    throw new Error("Membership response could not be verified.");
  return data;
}
export async function previewInvitation(
  shopId: string,
  token: string,
  signal?: AbortSignal,
) {
  const { data } = await api.post<StaffInvitationPreview>(
    `/staff-invitations/${encodeURIComponent(shopId)}/preview`,
    { token },
    { signal },
  );
  if (
    data.shopId !== shopId ||
    !["ADMIN", "MANAGER", "CASHIER", "KITCHEN"].includes(data.role)
  )
    throw new Error("Invitation context could not be verified.");
  return data;
}
export function staffInvitationLink(shopId: string, token: string) {
  // Fragments stay out of HTTP requests and referrer headers.
  return `${window.location.origin}/join/${encodeURIComponent(shopId)}#token=${token}`;
}
