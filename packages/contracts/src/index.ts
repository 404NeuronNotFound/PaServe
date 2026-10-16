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

/** Preparation/fulfillment states, separate from payment and order approval. */
export const PREPARATION_STATUSES = ["QUEUED", "PREPARING", "READY", "COMPLETED"] as const;
export type PreparationStatus = (typeof PREPARATION_STATUSES)[number];

/** Read-only owner overview; approval, payment and fulfillment stay independent. */
export interface ActiveOrderSummary {
  id: string;
  shopId: string;
  orderNumber: string;
  mode: "DINE_IN" | "TAKEOUT";
  tableNumber: string | null;
  status: "PENDING_CONFIRMATION" | "CONFIRMED";
  paymentStatus: "UNPAID" | "PAID";
  preparationStatus: Exclude<PreparationStatus, "COMPLETED"> | null;
  currency: "PHP";
  totalPrice: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveOrdersResponse {
  orders: ActiveOrderSummary[];
  nextCursor: string | null;
}

export const OWNER_ORDER_SEARCH_MAX_LENGTH = 80;

export type OwnerOrderView = "active" | "completed" | "cancelled";
export const OWNER_ACTIVE_STATUS_FILTERS = ["PENDING_CONFIRMATION", "CONFIRMED", "AWAITING_PAYMENT", "AWAITING_PREPARATION", "QUEUED", "PREPARING", "READY"] as const;
export const OWNER_PAYMENT_METHOD_FILTERS = ["CASH", "GCASH_MANUAL", "CARD_MANUAL", "OTHER", "UNRECORDED"] as const;
export interface OwnerOrderFilters {
  status?: (typeof OWNER_ACTIVE_STATUS_FILTERS)[number] | "COMPLETED" | "REJECTED";
  mode?: "DINE_IN" | "TAKEOUT";
  paymentMethod?: (typeof OWNER_PAYMENT_METHOD_FILTERS)[number];
  /** Inclusive calendar dates in Asia/Manila; not device-local timestamps. */
  from?: string;
  to?: string;
  /** Exact saved table label, case-insensitive. */
  table?: string;
}
export const OWNER_ORDER_FILTER_FIELDS = ["status", "mode", "paymentMethod", "from", "to", "table"] as const;

export function isOwnerOrderFilterDay(value: string): boolean {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value && !value.startsWith("9999-");
}

/** Reject unknown fields/values; empty scalar selections mean no constraint. */
export function normalizeOwnerOrderFilters(value: unknown, view: OwnerOrderView): OwnerOrderFilters | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !OWNER_ORDER_FILTER_FIELDS.some((field) => field === key))) return null;
  const normalized: Record<string, string> = {};
  for (const field of OWNER_ORDER_FILTER_FIELDS) {
    const raw = source[field];
    if (raw === undefined || raw === "") continue;
    if (field === "table") {
      if (typeof raw !== "string" || raw.length > TABLE_LIMITS.numberMaxLength * 2 || !TABLE_NUMBER_PATTERN.test(raw)) return null;
      const label = raw.normalize("NFC").trim();
      if ([...label].length > TABLE_LIMITS.numberMaxLength) return null;
      if (label) normalized[field] = label;
      continue;
    }
    if (typeof raw !== "string" || raw.length > 40 || /\p{Cc}/u.test(raw)) return null;
    if (raw.trim()) normalized[field] = raw.trim();
  }
  if (normalized.status && !(view === "active" ? OWNER_ACTIVE_STATUS_FILTERS.some((status) => status === normalized.status)
    : normalized.status === (view === "completed" ? "COMPLETED" : "REJECTED"))) return null;
  if (normalized.mode && !["DINE_IN", "TAKEOUT"].includes(normalized.mode)) return null;
  if (normalized.paymentMethod && (view === "cancelled" || !OWNER_PAYMENT_METHOD_FILTERS.some((method) => method === normalized.paymentMethod) ||
    (view === "completed" && normalized.paymentMethod === "UNRECORDED"))) return null;
  if ((normalized.from && !isOwnerOrderFilterDay(normalized.from)) || (normalized.to && !isOwnerOrderFilterDay(normalized.to)) ||
    (normalized.from && normalized.to && normalized.from > normalized.to) || (normalized.table && normalized.mode === "TAKEOUT")) return null;
  return normalized as OwnerOrderFilters;
}

/** Business-day bounds independent of browser/server timezone. To is inclusive. */
export function ownerOrderDateBounds(filters: OwnerOrderFilters): { gte?: string; lt?: string } {
  const midnight = (day: string) => Date.parse(`${day}T00:00:00.000Z`) - 8 * 60 * 60 * 1000;
  return {
    ...(filters.from ? { gte: new Date(midnight(filters.from)).toISOString() } : {}),
    ...(filters.to ? { lt: new Date(midnight(filters.to) + 86400000).toISOString() } : {}),
  };
}

/** Safe display-field query only; missing/blank means no search. */
export function normalizeOwnerOrderSearch(value: unknown): string | null {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > OWNER_ORDER_SEARCH_MAX_LENGTH || /\p{Cc}/u.test(value)) return null;
  return value.trim();
}

/** Fulfilled history uses the same eligibility as completed-sales reporting. */
export interface CompletedOrderSummary {
  id: string;
  shopId: string;
  orderNumber: string;
  mode: "DINE_IN" | "TAKEOUT";
  tableNumber: string | null;
  status: "CONFIRMED";
  paymentStatus: "PAID";
  preparationStatus: "COMPLETED";
  paymentMethod: "CASH" | "GCASH_MANUAL" | "CARD_MANUAL" | "OTHER";
  currency: "PHP";
  totalPrice: string;
  createdAt: string;
  paidAt: string;
  completedAt: string;
}

export interface CompletedOrdersResponse {
  orders: CompletedOrderSummary[];
  nextCursor: string | null;
}

/** Current terminal failure outcome is REJECTED; cancellation is not a stored state. */
export interface CancelledOrderSummary {
  id: string;
  shopId: string;
  orderNumber: string;
  mode: "DINE_IN" | "TAKEOUT";
  tableNumber: string | null;
  status: "REJECTED";
  paymentStatus: "UNPAID";
  preparationStatus: null;
  currency: "PHP";
  totalPrice: string;
  createdAt: string;
  decidedAt: string | null;
  /** Saved actor ID; retained even if the actor later leaves the shop. */
  decidedBy: string | null;
  rejectionReason: string | null;
}

export interface CancelledOrdersResponse {
  orders: CancelledOrderSummary[];
  nextCursor: string | null;
}

export function canTransitionPreparationStatus(
  from: PreparationStatus,
  to: PreparationStatus,
): boolean {
  return (
    (from === "QUEUED" && to === "PREPARING") ||
    (from === "PREPARING" && to === "READY") ||
    (from === "READY" && to === "COMPLETED")
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
/** Public shop identity captured at checkout, independent of later settings edits. */
/** Owner-only saved order projection; never includes customer bearer credentials. */
export type OwnerOrderAction = "CASHIER" | "START_PREPARING" | "MARK_READY" | "COMPLETE" | "RECEIPT";
export interface OwnerOrderDetailsResponse {
  order: {
    id: string;
    shopId: string;
    orderNumber: string;
    mode: "DINE_IN" | "TAKEOUT";
    tableNumber: string | null;
    status: "PENDING_CONFIRMATION" | "CONFIRMED" | "REJECTED";
    paymentStatus: "UNPAID" | "PAID";
    preparationStatus: PreparationStatus | null;
    currency: "PHP";
    totalPrice: string;
    shopDetails: ReceiptShopDetails | null;
    /** Null means the saved snapshot failed validation, never a live menu fallback. */
    items: ProductSelectionQuoteResponse[] | null;
    snapshotIssue: string | null;
    payment: ReceiptPaymentDetails | null;
    rejectionReason: string | null;
    createdAt: string;
    updatedAt: string;
    paidAt: string | null;
    completedAt: string | null;
    /** Recorded milestones, not a complete event journal or inferred transitions. */
    history: {
      status: "PLACED" | "CONFIRMED" | "REJECTED" | "PAID" | "QUEUED" | "PREPARING" | "READY" | "COMPLETED";
      at: string;
      actorId: string | null;
    }[];
    permittedActions: OwnerOrderAction[];
  };
}

export interface ReceiptShopDetails {
  name: string;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  website: string | null;
}
/** Allowlist receipt display fields at both API and browser boundaries. */
export function parseReceiptShopDetails(value: unknown): ReceiptShopDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const limits = { name: SHOP_LIMITS.nameMax, address: SHOP_SETTINGS_LIMITS.address,
    phone: SHOP_SETTINGS_LIMITS.phone, contactEmail: SHOP_SETTINGS_LIMITS.contactEmail,
    website: SHOP_SETTINGS_LIMITS.website };
  for (const [field, limit] of Object.entries(limits)) {
    const text = raw[field];
    if (text === null && field !== "name") continue;
    if (typeof text !== "string" || !text.trim() || text.length > limit) return null;
  }
  return {
    name: raw.name as string,
    address: raw.address as string | null,
    phone: raw.phone as string | null,
    contactEmail: raw.contactEmail as string | null,
    website: raw.website as string | null,
  };
}
export interface DineInOrderResponse {
  order: {
    id: string;
    shopDetails?: ReceiptShopDetails | null;
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
/** Authenticated cashier scanning/verification; only the signed token is input.
 * The active shop is route context. Neither action changes order state. */
export interface VerifyOrderQrRequest {
  qrToken: string;
}
export interface VerifyOrderQrResponse {
  verified: true;
  order: {
    id: string;
    shopDetails?: ReceiptShopDetails | null;
    shopId: string;
    orderNumber: string;
    mode: "DINE_IN" | "TAKEOUT";
    status: string;
    paymentStatus: string;
    currency: string;
    totalPrice: string;
    tableNumber: string | null;
    /** Saved receipt lines in submission order, never current menu data. */
    items: ProductSelectionQuoteResponse[];
    /** Opaque digest of the authoritative review, required for decisions. */
    reviewVersion: string;
  };
}
/** Credential-protected customer read model, without staff identity or internal payment metadata. */
export interface CustomerOrderStatusResponse {
  receipt?: CustomerReceiptSummary;
  trackingExpiresAt?: string;
  order: {
    id: string;
    shopId: string;
    orderNumber: string;
    status: "PENDING_CONFIRMATION" | "CONFIRMED" | "REJECTED";
    paymentStatus: "UNPAID" | "PAID";
    confirmedAt: string | null;
    preparationStatus: PreparationStatus | null;
    preparationStartedAt: string | null;
    preparationReadyAt: string | null;
    completedAt: string | null;
    updatedAt: string;
  };
}
/** Display data for reopening a credential-protected guest receipt. */
export interface CustomerReceiptSummary {
  shopSlug: string;
  shopName: string;
  shopDetails?: ReceiptShopDetails | null;
  primaryColor: string | null;
  accentColor: string | null;
  id: string;
  orderNumber: string;
  mode: "DINE_IN" | "TAKEOUT";
  table: { code: string; number: string } | null;
  status: "PENDING_CONFIRMATION";
  currency: "PHP";
  totalPrice: string;
  /** No order adjustments are modeled today; authoritative subtotal equals saved total. */
  subtotalPrice?: string;
  /** Saved receipt lines in submission order; optional for older API responses. */
  items?: ProductSelectionQuoteResponse[];
  /** Customer-safe saved method details; null before payment, absent on older APIs. */
  payment?: ReceiptPaymentDetails | null;
  /** Saved UTC instants; optional for older receipts. */
  createdAt?: string;
  paidAt?: string | null;
  completedAt?: string | null;
}
/** Validate canonical UTC timestamps without accepting ambiguous local dates. */
export function isReceiptTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return false;
  return time.toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
}
export interface OrderDecisionRequest extends VerifyOrderQrRequest {
  reviewVersion: string;
}
/** Authenticated staff fallback; numbers are scoped to the active shop. */
export interface LookupOrderNumberRequest { orderNumber: string; }
export interface OrderNumberDecisionRequest extends LookupOrderNumberRequest { reviewVersion: string; }
export interface RejectOrderNumberRequest extends OrderNumberDecisionRequest { rejectionReason?: string; }
export function isValidOrderNumber(value: unknown): value is string {
  if (typeof value !== 'string' || !/^ORD-\d{6,19}$(?![\s\S])/.test(value)) return false;
  const sequence = BigInt(value.slice(4));
  return sequence > 0n && sequence <= 9223372036854775807n;
}
export interface RejectOrderRequest extends OrderDecisionRequest {
  rejectionReason?: string;
}
export interface OrderDecisionResponse {
  order: {
    id: string;
    shopId: string;
    orderNumber: string;
    status: "CONFIRMED" | "REJECTED";
    paymentStatus: "UNPAID";
    decidedAt: string;
    decidedBy: string;
    rejectionReason: string | null;
  };
}
/** Cash tender uses exact PHP decimal strings, bounded by Decimal(12,2). */
export const CASH_AMOUNT_MAX = "9999999999.99";
export const CASH_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}$(?![\s\S])/;
export function cashAmountCents(value: unknown): bigint | null {
  return typeof value === "string" && CASH_AMOUNT_PATTERN.test(value)
    ? BigInt(value.replace(".", "")) : null;
}
export interface CashPaymentRequest {
  requestId: string;
  reviewVersion: string;
  amountReceived: string;
}
export interface CreatePaymentRequest {
  requestId: string;
  reviewVersion: string;
  method: "CASH" | "GCASH_MANUAL" | "CARD_MANUAL" | "OTHER";
  qrToken?: string;
  orderNumber?: string;
  amountReceived?: string;
  receivedConfirmed?: true;
  reference?: string | null;
  description?: string;
}
export interface ManualGcashPaymentRequest {
  requestId: string;
  reviewVersion: string;
  receivedConfirmed: true;
  reference?: string | null;
}
export type ManualCardPaymentRequest = ManualGcashPaymentRequest;
export interface OtherPaymentRequest extends ManualGcashPaymentRequest {
  description: string;
}
/** OTHER accepts method/reference notes, not raw payment-card details. */
export function isSafeOtherPaymentText(value: unknown, maxLength = 200): value is string {
  if (typeof value !== "string" || value.length > maxLength || !PAYMENT_REFERENCE_PATTERN.test(value)) return false;
  const normalized = value.normalize("NFKC");
  return !/\p{Nd}(?:[^\p{L}\p{N}]*\p{Nd}){12}/u.test(normalized) &&
    !/\b(?:cvv|cvc|pan|pin|expiry|expiration|security[ -]*code)\b/i.test(normalized);
}
export const PAYMENT_REFERENCE_PATTERN = /^[^\p{Cc}\p{Cf}<>]{0,200}$(?![\s\S])/u;
/** Public receipt projection; excludes cashier identity and internal request metadata. */
export interface ReceiptPaymentDetails {
  method: "CASH" | "GCASH_MANUAL" | "CARD_MANUAL" | "OTHER";
  reference: string | null;
  description: string | null;
  /** Exact saved cash tender; absent for non-cash and older receipt responses. */
  amountReceived?: string;
  /** Backend-calculated saved cash change; never recomputed for display. */
  changeDue?: string;
}
/** Free-text references must not turn the receipt into a credential display. */
function isSafeReceiptPaymentText(value: string): boolean {
  const normalized = value.normalize("NFKC");
  if (/\b(?:cvv|cvc|pan|pin|expiry|expiration|security[ -]*code|password|passcode|otp|secret|bearer|authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret)\b/i.test(normalized) ||
    /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/.test(normalized) ||
    /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/.test(normalized) ||
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(normalized)) return false;
  // Keep numeric transaction IDs, but omit recognized card numbers (Luhn),
  // including punctuated numbers accidentally entered as GCash references.
  return !(normalized.match(/\d(?:[^\p{L}\p{N}]*\d){12,18}/gu) ?? []).some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    const checksum = [...digits].reverse().reduce((sum, digit, index) => {
      let number = Number(digit);
      if (index % 2) number *= 2;
      return sum + (number > 9 ? number - 9 : number);
    }, 0);
    return checksum % 10 === 0;
  });
}
/** Keep method-specific reference rules, including numeric GCash transaction IDs. */
export function parseReceiptPaymentDetails(value: unknown): ReceiptPaymentDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.method !== "string" || !["CASH", "GCASH_MANUAL", "CARD_MANUAL", "OTHER"].includes(raw.method)) return null;
  const method = raw.method as ReceiptPaymentDetails["method"];
  if (method === "CASH" && raw.amountReceived !== undefined &&
    (typeof raw.amountReceived !== "string" || !CASH_AMOUNT_PATTERN.test(raw.amountReceived))) return null;
  if (method === "CASH" && raw.changeDue !== undefined &&
    (typeof raw.changeDue !== "string" || !CASH_AMOUNT_PATTERN.test(raw.changeDue) ||
      typeof raw.amountReceived !== "string" ||
      cashAmountCents(raw.changeDue)! > cashAmountCents(raw.amountReceived)!)) return null;
  const reference = method !== "CASH" && typeof raw.reference === "string" && raw.reference.trim() &&
    PAYMENT_REFERENCE_PATTERN.test(raw.reference) &&
    isSafeReceiptPaymentText(raw.reference) &&
    (method === "GCASH_MANUAL" || isSafeOtherPaymentText(raw.reference)) ? raw.reference : null;
  const description = method === "OTHER" && typeof raw.description === "string" && raw.description.trim() &&
    isSafeOtherPaymentText(raw.description, 80) && isSafeReceiptPaymentText(raw.description) ? raw.description : null;
  return { method, reference, description,
    ...(method === "CASH" && typeof raw.amountReceived === "string" ? { amountReceived: raw.amountReceived } : {}),
    ...(method === "CASH" && typeof raw.changeDue === "string" ? { changeDue: raw.changeDue } : {}),
  };
}
/** Terminal receipt identifiers only; reject recognizable raw card details. */
export function isSafeManualCardReference(value: unknown): boolean {
  return value == null || isSafeOtherPaymentText(value);
}
export interface CashPaymentReceipt {
  method: "CASH" | "GCASH_MANUAL" | "CARD_MANUAL" | "OTHER";
  requestId: string;
  amountReceived: string;
  changeDue: string;
  paidAt: string;
  paidBy: string;
  reference?: string | null;
  description?: string | null;
}
export interface CashPaymentReviewResponse {
  order: VerifyOrderQrResponse["order"];
  payment: CashPaymentReceipt | null;
  /** Absent on older servers; null for orders not yet queued. */
  queue?: OrderPreparationReceipt | null;
}
export interface OrderPreparationReceipt {
  status: PreparationStatus;
  queuedAt: string;
}
export interface PreparationQueueResponse {
  orders: Array<{
    id: string;
    shopId: string;
    orderNumber: string;
    mode: "DINE_IN" | "TAKEOUT";
    tableNumber: string | null;
    currency: "PHP";
    totalPrice: string;
    queuedAt: string;
    preparationStatus: PreparationStatus;
    preparationStartedAt?: string | null;
    preparationStartedBy?: string | null;
    preparationReadyAt?: string | null;
    preparationReadyBy?: string | null;
    completedAt?: string | null;
    completedBy?: string | null;
    items: ProductSelectionQuoteResponse[];
  }>;
  nextCursor: string | null;
}
export interface StartPreparationResponse {
  order: {
    id: string;
    shopId: string;
    preparationStatus: "PREPARING";
    queuedAt: string;
    preparationStartedAt: string;
    preparationStartedBy: string;
  };
  alreadyStarted: boolean;
}
export interface ReadyPreparationResponse {
  order: Omit<StartPreparationResponse["order"], "preparationStatus"> & {
    preparationStatus: "READY";
    preparationReadyAt: string;
    preparationReadyBy: string;
  };
  alreadyReady: boolean;
}
export interface CompletePreparationResponse {
  order: Omit<ReadyPreparationResponse["order"], "preparationStatus"> & {
    preparationStatus: "COMPLETED";
    completedAt: string;
    completedBy: string;
  };
  alreadyCompleted: boolean;
}
export interface CompletedSalesResponse {
  from: string;
  to: string;
  currency: "PHP";
  completedOrders: number;
  totalSales: string;
}

export const SALES_TIMEZONE = "Asia/Manila" as const;

/** Philippine business date, independent of the browser/server's local timezone. */
export function salesBusinessDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Midnight inclusive to next midnight exclusive; reject normalized invalid dates. */
export function salesBusinessDayBounds(date: unknown): { from: string; to: string } | null {
  if (typeof date !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) return null;
  const start = midnight - 8 * 60 * 60 * 1000;
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000).toISOString() };
}

export interface DailySalesResponse extends CompletedSalesResponse {
  itemsSold: number;
  shopId: string;
  businessDate: string;
  timezone: typeof SALES_TIMEZONE;
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
