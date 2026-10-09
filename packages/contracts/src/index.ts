export const REGISTRATION_LIMITS = {
  emailMax: 254,
  passwordMin: 12,
  passwordMax: 128,
} as const;

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface RegisteredUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface RegisterResponse {
  user: RegisteredUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: RegisteredUser;
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export type ShopRole = "OWNER" | "ADMIN" | "MANAGER" | "CASHIER" | "KITCHEN";

/** Explicit daily operations; these grants do not include role or billing changes. */
export const SHOP_OPERATIONAL_PERMISSIONS = [
  "shop.menu.manage",
  "shop.orders.manage",
  "shop.reports.read",
  "shop.daily-operations.manage",
] as const;

/** Front-counter actions; no refunds, price edits, menu editing or shop billing. */
export const SHOP_CASHIER_PERMISSIONS = [
  "shop.orders.qr.scan",
  "shop.orders.read",
  "shop.payments.record",
  "shop.orders.confirm",
  "shop.orders.reject",
  "shop.menu.availability.update",
] as const;

/** Kitchen and barista authority, separate from checkout and order approval. */
export const SHOP_KITCHEN_PERMISSIONS = [
  "shop.preparation.queue.read",
  "shop.preparation.status.update",
] as const;

/** Preparation-only states; these are not payment or order-approval states. */
export const PREPARATION_STATUSES = ["QUEUED", "PREPARING", "READY"] as const;
export type PreparationStatus = (typeof PREPARATION_STATUSES)[number];

export function canTransitionPreparationStatus(
  from: PreparationStatus,
  to: PreparationStatus,
): boolean {
  return (from === "QUEUED" && to === "PREPARING") ||
    (from === "PREPARING" && to === "READY");
}

/** Shop-scoped authority. Ownership/billing permissions are reserved for future flows. */
export const SHOP_PERMISSIONS = [
  ...SHOP_OPERATIONAL_PERMISSIONS,
  ...SHOP_CASHIER_PERMISSIONS,
  ...SHOP_KITCHEN_PERMISSIONS,
  "shop.operations.manage",
  "shop.settings.manage",
  "shop.ownership.manage",
  "shop.billing.manage",
] as const;
export type ShopPermission = (typeof SHOP_PERMISSIONS)[number];

export function isShopOwner(role: ShopRole): boolean {
  return role === "OWNER";
}

/**
 * OWNER is the highest shop-level role, not a global account role.
 * Call only with the role from a validated membership for the target shop.
 * MANAGER has explicit daily-operation grants; ADMIN also has full operations.
 * CASHIER has explicit front-counter grants, shared with the management roles.
 * KITCHEN has queue/preparation grants, also shared with management roles.
 * Settings, ownership and billing remain OWNER-only.
 * Other roles receive explicit grants in their respective authorization steps;
 * a numeric role ranking must never grant owner-sensitive permissions.
 */
export function hasShopPermission(
  role: ShopRole,
  permission: ShopPermission,
): boolean {
  if (isShopOwner(role)) return SHOP_PERMISSIONS.includes(permission);
  const dailyOperation = SHOP_OPERATIONAL_PERMISSIONS.some(
    (allowed) => allowed === permission,
  );
  const counterAction = SHOP_CASHIER_PERMISSIONS.some(
    (allowed) => allowed === permission,
  );
  const preparationAction = SHOP_KITCHEN_PERMISSIONS.some(
    (allowed) => allowed === permission,
  );
  if (role === "ADMIN")
    return permission === "shop.operations.manage" || dailyOperation || counterAction || preparationAction;
  if (role === "MANAGER") return dailyOperation || counterAction || preparationAction;
  if (role === "CASHIER") return counterAction;
  return role === "KITCHEN" && preparationAction;
}

export interface UserMembership {
  id: string;
  shopId: string;
  role: ShopRole;
  shop: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
  };
}

export interface CurrentUser extends RegisteredUser {
  firstName: string | null;
  lastName: string | null;
  memberships: UserMembership[];
}

export interface CurrentUserResponse {
  user: CurrentUser;
}

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export const SHOP_LIMITS = { nameMax: 120, descriptionMax: 1000 } as const;
export const SHOP_SETTINGS_LIMITS = {
  displayName: 120,
  phone: 40,
  contactEmail: 254,
  website: 2048,
  address: 500,
  operatingHours: 1000,
} as const;

export const SHOP_PHONE_HINT =
  "Use 7–15 digits. A leading +, spaces, hyphens and parentheses are allowed.";
export function isValidShopPhone(value: string): boolean {
  const phone = value.trim();
  if (!phone) return true;
  const digits = phone.replace(/[^0-9]/g, "");
  if (!/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 7 || digits.length > 15)
    return false;
  let parentheses = 0;
  for (const character of phone) {
    if (character === "(" && ++parentheses > 1) return false;
    if (character === ")" && --parentheses < 0) return false;
  }
  return parentheses === 0;
}

export interface CreateShopRequest {
  name: string;
  description?: string;
}

export interface CreateShopResponse {
  shop: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isActive: boolean;
    createdAt: string;
  };
  membership: UserMembership;
}

export interface ShopMembershipResponse {
  membership: UserMembership;
}

export interface UpdateShopRequest {
  name?: string;
  description?: string;
  displayName?: string;
  phone?: string;
  contactEmail?: string;
  website?: string;
  address?: string;
  operatingHours?: string;
}

export type ShopSettings = CreateShopResponse["shop"] & {
  displayName: string | null;
  phone: string | null;
  contactEmail: string | null;
  website: string | null;
  address: string | null;
  operatingHours: string | null;
};

export interface UpdateShopResponse {
  shop: ShopSettings;
}
export type ShopSettingsResponse = UpdateShopResponse;
