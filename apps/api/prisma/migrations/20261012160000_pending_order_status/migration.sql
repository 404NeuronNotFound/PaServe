-- Phase 10 orders await shop acceptance; migrate the earlier placement marker.
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_check";
UPDATE "orders" SET "status" = 'PENDING' WHERE "status" = 'PLACED';
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("status" = 'PENDING');
