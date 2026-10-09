import { createContext, useContext } from "react";
import type { UserMembership } from "@paserve/contracts";

// A navigation hint only. Membership and role always come from the API.
const key = (userId: string) => `paserve-active-shop:${userId}`;
export function rememberedShop(userId: string): string | null {
  try {
    return sessionStorage.getItem(key(userId));
  } catch {
    return null;
  }
}
export function rememberShop(userId: string, shopId: string | null) {
  try {
    if (shopId) sessionStorage.setItem(key(userId), shopId);
    else sessionStorage.removeItem(key(userId));
  } catch {
    /* Selection still works when browser storage is unavailable. */
  }
}

export const activeShopKey = (userId: string, shopId: string) =>
  ["shops", userId, shopId, "membership"] as const;
export const shopPath = (shopId: string) =>
  `/app/shops/${encodeURIComponent(shopId)}`;
export const ActiveShopContext = createContext<UserMembership | null>(null);

export function useActiveShop(): UserMembership {
  const membership = useContext(ActiveShopContext);
  if (!membership)
    throw new Error("Business screens require a validated active shop.");
  return membership;
}
