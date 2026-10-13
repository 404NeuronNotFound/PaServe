BEGIN;
ALTER TABLE orders
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "paymentRequestId" TEXT,
  ADD COLUMN "paymentReviewVersion" TEXT,
  ADD COLUMN "amountReceived" DECIMAL(12,2),
  ADD COLUMN "changeDue" DECIMAL(12,2),
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "paidBy" TEXT;
-- Replace the prior submission-only payment constraint, preserving tenant RLS.
ALTER TABLE orders DROP CONSTRAINT "orders_paymentStatus_check";
ALTER TABLE orders ADD CONSTRAINT "orders_payment_status_check"
  CHECK ("paymentStatus" IN ('UNPAID', 'PAID'));
ALTER TABLE orders ADD CONSTRAINT "orders_cash_payment_check" CHECK (
  ("paymentStatus" = 'UNPAID' AND "paymentMethod" IS NULL AND "paymentRequestId" IS NULL
    AND "paymentReviewVersion" IS NULL AND "amountReceived" IS NULL AND "changeDue" IS NULL
    AND "paidAt" IS NULL AND "paidBy" IS NULL)
  OR
  ("paymentStatus" = 'PAID' AND status = 'CONFIRMED' AND currency = 'PHP'
    AND "paymentMethod" IS NOT NULL AND "paymentMethod" = 'CASH'
    AND "paymentRequestId" IS NOT NULL AND "paymentRequestId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND "paymentReviewVersion" IS NOT NULL AND "paymentReviewVersion" ~ '^[a-f0-9]{64}$'
    AND "amountReceived" IS NOT NULL AND "amountReceived" >= "totalPrice" AND "amountReceived" <= 9999999999.99
    AND "changeDue" IS NOT NULL AND "changeDue" = "amountReceived" - "totalPrice" AND "changeDue" >= 0 AND "changeDue" <= 9999999999.99
    AND "paidAt" IS NOT NULL AND "paidBy" IS NOT NULL AND length(btrim("paidBy")) > 0)
);
CREATE UNIQUE INDEX "orders_shopId_paymentRequestId_key" ON orders ("shopId", "paymentRequestId");
-- Corrections/refunds require a future explicit workflow, never a second cash write.
CREATE FUNCTION protect_cash_payment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."paymentStatus" = 'PAID' AND
    ROW(NEW."paymentStatus", NEW."paymentMethod", NEW."paymentRequestId", NEW."paymentReviewVersion",
        NEW."amountReceived", NEW."changeDue", NEW."paidAt", NEW."paidBy", NEW."totalPrice", NEW.currency, NEW.status, NEW."shopId", NEW.id, NEW."orderNumber")
    IS DISTINCT FROM
    ROW(OLD."paymentStatus", OLD."paymentMethod", OLD."paymentRequestId", OLD."paymentReviewVersion",
        OLD."amountReceived", OLD."changeDue", OLD."paidAt", OLD."paidBy", OLD."totalPrice", OLD.currency, OLD.status, OLD."shopId", OLD.id, OLD."orderNumber")
  THEN RAISE EXCEPTION 'Paid cash receipts are immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_cash_payment_immutable BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION protect_cash_payment_receipt();
COMMIT;
