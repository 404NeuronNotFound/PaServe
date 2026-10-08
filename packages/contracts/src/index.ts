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
