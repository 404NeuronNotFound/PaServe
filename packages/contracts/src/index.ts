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

export const SHOP_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "KITCHEN",
] as const;
export type ShopRole = (typeof SHOP_ROLES)[number];

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
  return (
    (from === "QUEUED" && to === "PREPARING") ||
    (from === "PREPARING" && to === "READY")
  );
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
    return (
      permission === "shop.operations.manage" ||
      dailyOperation ||
      counterAction ||
      preparationAction
    );
  if (role === "MANAGER")
    return dailyOperation || counterAction || preparationAction;
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

export const CATEGORY_LIMITS = {
  nameMax: 80,
  slugMax: 80,
  descriptionMax: 500,
} as const;
export interface CreateCategoryRequest {
  name: string;
}
export interface MenuCategory {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  slug: string;
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
}
export interface CreateCategoryResponse {
  category: MenuCategory;
}
export interface CategoriesResponse {
  categories: MenuCategory[];
}
export interface UpdateCategoryRequest {
  name?: string;
  description?: string;
}
export type UpdateCategoryResponse = CreateCategoryResponse;
export const CATEGORY_REORDER_MAX = 500;
export const PRODUCT_LIMITS = {
  nameMax: 120,
  slugMax: 120,
  descriptionMax: 2000,
  imageUrlMax: 2048,
  sortOrderMax: 2147483647,
} as const;
export const PRODUCT_STATUSES = ["AVAILABLE", "SOLD_OUT", "HIDDEN"] as const;
export const PRODUCT_IMAGE_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxPixels: 16_000_000,
  maxDimension: 8192,
} as const;
export const PRODUCT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export interface ProductImageResponse extends CreateProductResponse {
  storagePath: string;
}
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const PRODUCT_PRICE_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
/** Application currency; product prices are exact decimal strings in PHP. */
export const PRODUCT_CURRENCY = "PHP" as const;
export const PRODUCT_VARIANT_LIMITS = {
  nameMax: 80,
  sortOrderMax: 1000000,
} as const;
export interface CreateProductOptionGroupRequest {
  /** Owner-defined label, e.g. Size, Temperature, Flavor or Serving size. */
  name: string;
  isRequired?: boolean;
  isAvailable?: boolean;
  sortOrder?: number;
}
export interface CreateProductVariantRequest {
  /** Owner-defined choice label; adding choices never requires a new enum member. */
  name: string;
  /** Nonnegative PHP surcharge, sent as an exact decimal string. */
  priceAdjustment: string;
  optionGroupId?: string | null;
  /** Base/default choice: must have a zero surcharge. One per choice group. */
  isDefault?: boolean;
  isAvailable?: boolean;
  sortOrder?: number;
}
export type UpdateProductOptionGroupRequest = Partial<CreateProductOptionGroupRequest>;
export type UpdateProductVariantRequest = Partial<CreateProductVariantRequest>;
export interface CreateRegularVariantRequest {
  optionGroupId?: string | null;
  sortOrder?: number;
}
export interface CreateLargeVariantRequest extends CreateRegularVariantRequest {
  /** Positive PHP surcharge on the product base price, not an absolute price. */
  priceAdjustment: string;
}
export interface ProductOptionGroup {
  id: string;
  shopId: string;
  productId: string;
  name: string;
  isRequired: boolean;
  isAvailable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
export interface ProductVariant {
  id: string;
  shopId: string;
  productId: string;
  optionGroupId: string | null;
  name: string;
  priceAdjustment: string;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
export interface ProductVariantsResponse {
  optionGroups: ProductOptionGroup[];
  variants: ProductVariant[];
}
export interface ProductVariantResponse {
  variant: ProductVariant;
}
export interface ProductOptionGroupResponse {
  optionGroup: ProductOptionGroup;
}
export const ADD_ON_LIMITS = {
  nameMax: 80,
  sortOrderMax: 1000000,
  selectionMax: 50,
} as const;
export interface CreateAddOnRequest {
  name: string;
  priceAdjustment: string;
  isAvailable?: boolean;
  sortOrder?: number;
}
export type UpdateAddOnRequest = Partial<CreateAddOnRequest>;
export interface AddOn {
  id: string;
  shopId: string;
  name: string;
  priceAdjustment: string;
  isAvailable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
export interface AddOnResponse {
  addOn: AddOn;
}
export interface AddOnsResponse {
  addOns: AddOn[];
}
export interface AssignProductAddOnRequest {
  addOnId: string;
}
export interface AddOnSelectionRequest {
  addOnIds: string[];
}
export interface PublicAddOn {
  id: string;
  name: string;
  priceAdjustment: string;
}
export interface PublicProductAddOnsResponse {
  productId: string;
  isOrderable: boolean;
  addOns: PublicAddOn[];
}
/** One base product plus selected add-ons; variant pricing is a separate pending flow. */
export interface ProductAddOnQuoteResponse {
  productId: string;
  currency: typeof PRODUCT_CURRENCY;
  basePrice: string;
  addOns: PublicAddOn[];
  addOnTotal: string;
  baseWithAddOnsPrice: string;
}
export function isValidProductImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export interface CreateProductRequest {
  name: string;
  price: string;
  categoryId?: string;
  description?: string;
  status?: ProductStatus;
  imageUrl?: string;
  isFeatured?: boolean;
  sortOrder?: number;
}
export interface MenuProduct {
  id: string;
  shopId: string;
  categoryId: string | null;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  status: ProductStatus;
  imageUrl: string | null;
  isFeatured: boolean;
  isArchived: boolean;
  sortOrder: number;
  createdAt: string;
}
export interface CreateProductResponse {
  product: MenuProduct;
}
export interface UpdateProductRequest extends Partial<
  Omit<CreateProductRequest, "categoryId">
> {
  categoryId?: string | null;
}
export type UpdateProductResponse = CreateProductResponse;
export interface ProductArchiveRequest {
  isArchived: boolean;
  expectedArchived: boolean;
}
export type ProductArchiveResponse = CreateProductResponse;
export interface ProductAvailableRequest {
  expectedStatus: ProductStatus;
}
export type ProductSoldOutRequest = ProductAvailableRequest;
export type ProductHiddenRequest = ProductAvailableRequest;
export interface ProductFeaturedRequest {
  isFeatured: boolean;
  expectedFeatured: boolean;
}
export interface ProductsResponse {
  products: MenuProduct[];
}
export const PRODUCT_REORDER_MAX = 500;
export interface ReorderProductsRequest {
  categoryId: string | null;
  productIds: string[];
  expectedOrder: string[];
}
export interface ReorderCategoriesRequest {
  categoryIds: string[];
  expectedOrder: string[];
}
export interface SetCategoryVisibilityRequest {
  isVisible: boolean;
  expectedVisibility: boolean;
}
export interface PublicMenuResponse {
  featuredProducts: PublicMenuResponse["products"];
  shop: { name: string; slug: string; description: string | null };
  categories: Array<
    Pick<MenuCategory, "id" | "name" | "slug" | "description" | "sortOrder">
  >;
  products: Array<{
    id: string;
    categoryId: string | null;
    name: string;
    slug: string;
    description: string | null;
    price: string;
    imageUrl: string | null;
    status: "AVAILABLE" | "SOLD_OUT";
    isOrderable: boolean;
    isFeatured: boolean;
    sortOrder: number;
  }>;
}
