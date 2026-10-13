BEGIN;
-- Preserve historical confirmed/unpaid rows for settlement; enforce all new writes.
ALTER TABLE orders ADD CONSTRAINT orders_confirmation_requires_payment
  CHECK (status <> 'CONFIRMED' OR "paymentStatus" = 'PAID') NOT VALID;
COMMIT;
