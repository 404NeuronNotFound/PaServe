BEGIN;
-- Expand manual settlement while preserving cash/GCash receipts and safeguards.
ALTER TABLE orders DROP CONSTRAINT "orders_cash_payment_check";
ALTER TABLE orders ADD CONSTRAINT "orders_cash_payment_check" CHECK (
  ("paymentStatus" = 'UNPAID' AND "paymentMethod" IS NULL AND "paymentRequestId" IS NULL
    AND "paymentReviewVersion" IS NULL AND "amountReceived" IS NULL AND "changeDue" IS NULL
    AND "paidAt" IS NULL AND "paidBy" IS NULL)
  OR
  ("paymentStatus" = 'PAID' AND status = 'CONFIRMED' AND currency = 'PHP'
    AND "paymentMethod" IS NOT NULL AND "paymentMethod" IN ('CASH', 'GCASH_MANUAL', 'CARD_MANUAL')
    AND "paymentRequestId" IS NOT NULL AND "paymentRequestId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND "paymentReviewVersion" IS NOT NULL AND "paymentReviewVersion" ~ '^[a-f0-9]{64}$'
    AND "amountReceived" IS NOT NULL AND "amountReceived" >= "totalPrice" AND "amountReceived" <= 9999999999.99
    AND "changeDue" IS NOT NULL AND "changeDue" = "amountReceived" - "totalPrice" AND "changeDue" >= 0 AND "changeDue" <= 9999999999.99
    AND ("paymentMethod" = 'CASH' OR ("amountReceived" = "totalPrice" AND "changeDue" = 0))
    AND "paidAt" IS NOT NULL AND "paidBy" IS NOT NULL AND length(btrim("paidBy")) > 0)
);
ALTER TABLE orders DROP CONSTRAINT orders_payment_reference_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_reference_check CHECK (
  "paymentReference" IS NULL OR
  ("paymentStatus" = 'PAID' AND "paymentMethod" IN ('GCASH_MANUAL', 'CARD_MANUAL')
    AND length(btrim("paymentReference")) BETWEEN 1 AND 200
    AND "paymentReference" !~ '[[:cntrl:]<>]')
);
COMMIT;
