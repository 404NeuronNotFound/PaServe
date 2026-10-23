import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_POLICY = 'paserve:rate-limit';
// Requests per rolling minute. Scoped budgets also have a per-IP ceiling so
// changing a shop/resource/token/request ID cannot mint unlimited fresh buckets.
export const RATE_LIMITS = {
  register: { limit: 5, aggregate: 5, shop: false },
  login: { limit: 10, aggregate: 10, shop: false },
  refresh: { limit: 30, aggregate: 30, shop: false },
  logout: { limit: 30, aggregate: 30, shop: false },
  session: { limit: 120, aggregate: 120, shop: false },
  accountUpdate: { limit: 10, aggregate: 10, shop: false },
  orderCreate: { limit: 30, aggregate: 120, shop: true },
  quote: { limit: 120, aggregate: 360, shop: true },
  receiptProof: { limit: 30, aggregate: 120, shop: true },
  receiptRead: { limit: 600, aggregate: 1200, shop: true },
  staffVerification: { limit: 120, aggregate: 240, shop: true },
  invitationCreate: { limit: 10, aggregate: 10, shop: false },
  invitationProof: { limit: 30, aggregate: 120, shop: true },
  upload: { limit: 20, aggregate: 60, shop: true },
  shopCreate: { limit: 5, aggregate: 5, shop: false },
  reports: { limit: 60, aggregate: 180, shop: true },
  tableContext: { limit: 120, aggregate: 360, shop: true },
  publicRead: { limit: 600, aggregate: 1200, shop: true },
  stream: { limit: 60, aggregate: 180, shop: true },
  orderAction: { limit: 120, aggregate: 360, shop: true },
} as const;
export type RateLimitPolicy = keyof typeof RATE_LIMITS;
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Admission control only; all authentication and domain guards still apply. */
export const RateLimit = (policy: RateLimitPolicy) =>
  SetMetadata(RATE_LIMIT_POLICY, policy);
