BEGIN;
ALTER TABLE "orders" ADD COLUMN "decidedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "decidedBy" TEXT;
ALTER TABLE "orders" ADD COLUMN "rejectionReason" VARCHAR(300);
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check"
  CHECK ("status" IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_decision_check" CHECK (
  ("status" = 'PENDING_CONFIRMATION' AND "decidedAt" IS NULL AND "decidedBy" IS NULL AND "rejectionReason" IS NULL)
  OR ("status" IN ('CONFIRMED', 'REJECTED') AND "decidedAt" IS NOT NULL AND "decidedBy" IS NOT NULL AND length(btrim("decidedBy")) > 0 AND "qrTokenRevokedAt" IS NOT NULL)
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_rejection_reason_check" CHECK (
  "rejectionReason" IS NULL OR ("status" = 'REJECTED' AND length(btrim("rejectionReason")) > 0)
);
-- Payment stays separate; retain the existing UNPAID-only constraint and RLS.
COMMIT;
