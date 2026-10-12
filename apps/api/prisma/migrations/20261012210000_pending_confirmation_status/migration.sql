-- Rename the persisted initial order state without changing approval/payment semantics.
BEGIN;
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_check";
UPDATE "orders" SET "status" = 'PENDING_CONFIRMATION' WHERE "status" = 'PENDING';
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING_CONFIRMATION';
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check"
  CHECK ("status" = 'PENDING_CONFIRMATION');
COMMIT;
