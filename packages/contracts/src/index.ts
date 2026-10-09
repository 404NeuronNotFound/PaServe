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
