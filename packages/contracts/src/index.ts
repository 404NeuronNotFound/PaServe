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

export const STAFF_ROLES = ["ADMIN", "MANAGER", "CASHIER", "KITCHEN"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export interface StaffMember {
  id: string;
  userId: string;
  email: string;
  role: ShopRole;
  isActive: boolean;
}
export interface StaffInvitation {
  id: string;
  email: string;
  role: StaffRole;
  expiresAt: string;
  status: "PENDING" | "EXPIRED" | "REVOKED" | "ACCEPTED";
}
export interface ShopStaffResponse {
  shopId: string;
  members: StaffMember[];
  invitations: StaffInvitation[];
}
export interface CreateStaffInvitationRequest { email: string; role: StaffRole }
export interface CreateStaffInvitationResponse {
  shopId: string;
  invitation: StaffInvitation;
  /** Returned once. Keep out of persistent storage and logs. */
  token: string;
}
export interface AcceptStaffInvitationResponse {
  shopId: string;
  role: StaffRole;
}
export interface StaffInvitationPreview {
  shopId: string;
  shopName: string;
  email: string;
  role: StaffRole;
  expiresAt: string;
}

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
    logoUrl?: string | null;
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
  acceptingOrders?: boolean;
  menuLayout?: MenuLayout;
  primaryColor?: string;
  accentColor?: string;
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
  acceptingOrders?: boolean;
  menuLayout?: MenuLayout;
  primaryColor?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
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

export const DEFAULT_MENU_PRIMARY_COLOR = "#243329";
export const MENU_LAYOUTS = ["grid", "list", "compact"] as const;
export type MenuLayout = (typeof MENU_LAYOUTS)[number];
export const DEFAULT_MENU_LAYOUT: MenuLayout = "list";
export const isMenuLayout = (value: unknown): value is MenuLayout =>
  typeof value === "string" && MENU_LAYOUTS.some((layout) => layout === value);
export const DEFAULT_MENU_ACCENT_COLOR = "#C9EF83";
export const SHOP_ACCENT_COLOR_HINT =
  "Use a six-digit hex color, such as #C9EF83, or leave blank for the default.";
export const SHOP_PRIMARY_COLOR_HINT =
  "Use a six-digit hex color, such as #243329, or leave blank for the default.";
export const isValidShopPrimaryColor = (value: string): boolean =>
  value.trim() === "" || /^#[0-9a-f]{6}$/i.test(value.trim());
export const normalizeShopPrimaryColor = (value: string): string =>
  value.trim().toUpperCase();

export const SHOP_LOGO_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxPixels: 16_000_000,
  maxDimension: 8192,
  outputDimension: 512,
} as const;
export const SHOP_LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export interface ShopLogoResponse {
  shop: ShopSettings;
  storagePath: string;
}

export const SHOP_BANNER_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxPixels: 16_000_000,
  maxDimension: 8192,
  outputWidth: 1920,
  outputHeight: 640,
} as const;
export const SHOP_BANNER_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export interface ShopBannerResponse {
  shop: ShopSettings;
  storagePath: string;
}

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
  /** Owner-defined modifier label, including extras or removal instructions. */
  name: string;
  /** Nonnegative surcharge; use "0.00" for a free modifier or removal. */
  priceAdjustment: string;
  isAvailable?: boolean;
  sortOrder?: number;
}
export type UpdateAddOnRequest = Partial<CreateAddOnRequest>;
export interface CreateExtraShotRequest {
  /** Positive owner-configured PHP surcharge for one extra shot. */
  priceAdjustment: string;
  sortOrder?: number;
}
export interface CreateOatMilkRequest {
  /** Positive owner-configured PHP surcharge for the Oat Milk modifier. */
  priceAdjustment: string;
  sortOrder?: number;
}
export interface AddOn {
  id: string;
  shopId: string;
  name: string;
  priceAdjustment: string;
  isAvailable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Included in the authorized shop catalog only; absent from public responses. */
  assignedProducts?: Array<{ id: string; name: string; isArchived: boolean }>;
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
export const CUSTOMER_NOTE_MAX_LENGTH = 300;
/** Plain text: allow line breaks/tabs; reject controls, bidi overrides and lone surrogates. */
export const CUSTOMER_NOTE_PATTERN = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]*$/u;
export function normalizeCustomerNote(value: string): string | undefined {
  const normalized = value.replace(/\r\n?/g, "\n");
  // Preserve invalid input for validation: trim must not erase forbidden controls.
  if (!CUSTOMER_NOTE_PATTERN.test(normalized)) return normalized;
  return normalized.trim() || undefined;
}
export interface AddOnSelectionRequest {
  addOnIds: string[];
  /** Optional per-item preparation instruction, rendered only as plain text. */
  notes?: string;
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
  notes?: string;
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
  featuredSortOrder?: number;
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
export interface ReorderFeaturedProductsRequest {
  productIds: string[];
  expectedOrder: string[];
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
  /** Resolved by the server for a public table link; never an authorization token. */
  table?: PublicTableContext;
  featuredProducts: PublicMenuResponse["products"];
  shop: {
    name: string;
    slug: string;
    description: string | null;
    logoUrl?: string | null;
    bannerUrl?: string | null;
    primaryColor?: string | null;
    menuLayout?: MenuLayout;
    accentColor?: string | null;
  };
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
    featuredSortOrder?: number;
  }>;
}

export interface PublicProductDetailsResponse {
  product: PublicMenuResponse["products"][number];
  optionGroups: Array<Pick<ProductOptionGroup, "id" | "name" | "isRequired">>;
  variants: Array<Pick<ProductVariant, "id" | "optionGroupId" | "name" | "priceAdjustment" | "isDefault">>;
  addOns: PublicAddOn[];
}
export interface ProductSelectionRequest {
  variantIds: string[];
  addOnIds: string[];
  quantity: number;
  notes?: string;
}
export interface ProductSelectionQuoteResponse {
  productId: string;
  productName: string;
  currency: typeof PRODUCT_CURRENCY;
  basePrice: string;
  unitPrice: string;
  totalPrice: string;
  quantity: number;
  notes?: string;
  variants: PublicProductDetailsResponse["variants"];
  addOns: PublicAddOn[];
}
export const TABLE_LIMITS = { numberMaxLength: 40 } as const;
export const TABLE_CODE_PATTERN = /^t_[0-9a-f]{32}$(?![\s\S])/;
// Previously issued codes remain valid; never regenerate a saved public locator.
export const PUBLIC_TABLE_CODE_PATTERN = /^(?:t_[0-9a-f]{32}|T[0-9]{1,40}|T-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$(?![\s\S])/;
export function publicTablePath(shopSlug: string, code: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$(?![\s\S])/.test(shopSlug) || shopSlug.length > 100 || !PUBLIC_TABLE_CODE_PATTERN.test(code)) {
    throw new Error("A valid shop slug and public table code are required.");
  }
  return `/${encodeURIComponent(shopSlug)}/table/${encodeURIComponent(code)}`;
}
export const TABLE_NUMBER_PATTERN = /^[^\p{Cc}\p{Cf}\p{Cs}]*$/u;
export function normalizeTableNumber(value: string): string {
  // Do not let trimming or collapsing spaces erase invalid control characters.
  return TABLE_NUMBER_PATTERN.test(value)
    ? value.normalize("NFC").trim().replace(/\p{Zs}+/gu, " ")
    : value;
}
const tableNumberCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export function compareTableNumbers(a: { number: string; id: string }, b: { number: string; id: string }): number {
  return tableNumberCollator.compare(a.number, b.number) || a.id.localeCompare(b.id);
}
export interface CreateTableRequest {
  number: string;
}
export interface PublicTableContext {
  shopSlug: string;
  code: string;
  number: string;
  /** Server-signed shop/table binding, kept in memory; obtain a fresh token on refresh. */
  checkoutToken?: string;
}
/** Selection data; order submission resolves/revalidates the table and items. */
export interface CustomerCheckoutRequest {
  mode?: "DINE_IN" | "TAKEOUT";
  tableCode?: string;
  tableToken?: string;
  items: (ProductSelectionRequest & { productId: string })[];
}
export interface CreateDineInOrderRequest extends CustomerCheckoutRequest {
  mode?: "DINE_IN";
  requestId: string;
  tableCode: string;
  tableToken: string;
}
export interface CreateTakeoutOrderRequest {
  requestId: string;
  mode: "TAKEOUT";
  tableCode?: never;
  tableToken?: never;
  items: CustomerCheckoutRequest["items"];
}
export type CreateCustomerOrderRequest = CreateDineInOrderRequest | CreateTakeoutOrderRequest;
export interface DineInOrderResponse {
  order: {
    id: string;
    mode: "DINE_IN";
    /** Awaiting staff confirmation; implements the roadmap's PENDING_CONFIRMATION state. */
    status: "PENDING_CONFIRMATION";
    table: PublicTableContext;
    /** Parent metadata emitted by current API; optional for older confirmations. */
    orderNumber?: string;
    paymentStatus?: "UNPAID";
    updatedAt?: string;
    qrToken?: string;
    qrTokenExpiresAt?: string;
    currency: typeof PRODUCT_CURRENCY;
    /** Always emitted by current API; optional for confirmations from older deployments. */
    subtotalPrice?: string;
    totalPrice: string;
    items: ProductSelectionQuoteResponse[];
    createdAt: string;
  };
}
export interface TakeoutOrderResponse {
  order: Omit<DineInOrderResponse["order"], "mode" | "table"> & { mode: "TAKEOUT"; table: null };
}
export type CustomerOrderResponse = DineInOrderResponse | TakeoutOrderResponse;
/** Authenticated cashier verification; this action does not change order state. */
export interface VerifyOrderQrRequest {
  qrToken: string;
}
export interface VerifyOrderQrResponse {
  verified: true;
  order: {
    id: string;
    shopId: string;
    orderNumber: string;
    mode: "DINE_IN" | "TAKEOUT";
    status: string;
    paymentStatus: string;
    currency: string;
    totalPrice: string;
    tableNumber: string | null;
  };
}
export interface RestaurantTable {
  id: string;
  shopId: string;
  number: string;
  code: string;
  isActive: boolean;
  createdAt: string;
}
export interface CreateTableResponse {
  table: RestaurantTable;
}
export interface TablesResponse {
  tables: RestaurantTable[];
}
