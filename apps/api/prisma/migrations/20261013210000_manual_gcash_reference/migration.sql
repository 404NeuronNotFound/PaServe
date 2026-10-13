BEGIN;
ALTER TABLE orders ADD COLUMN "paymentReference" VARCHAR(200);
ALTER TABLE orders ADD CONSTRAINT orders_payment_reference_check CHECK (
  "paymentReference" IS NULL OR
  ("paymentStatus" = 'PAID' AND "paymentMethod" = 'GCASH_MANUAL'
    AND length(btrim("paymentReference")) BETWEEN 1 AND 200
    AND "paymentReference" !~ '[[:cntrl:]<>]')
);
-- Keep the reference immutable together with all existing paid receipt fields.
CREATE OR REPLACE FUNCTION protect_cash_payment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."paymentStatus" = 'PAID' AND
    ROW(NEW."paymentStatus", NEW."paymentMethod", NEW."paymentRequestId", NEW."paymentReviewVersion", NEW."paymentReference",
        NEW."amountReceived", NEW."changeDue", NEW."paidAt", NEW."paidBy", NEW."totalPrice", NEW.currency, NEW.status, NEW."shopId", NEW.id, NEW."orderNumber")
    IS DISTINCT FROM
    ROW(OLD."paymentStatus", OLD."paymentMethod", OLD."paymentRequestId", OLD."paymentReviewVersion", OLD."paymentReference",
        OLD."amountReceived", OLD."changeDue", OLD."paidAt", OLD."paidBy", OLD."totalPrice", OLD.currency, OLD.status, OLD."shopId", OLD.id, OLD."orderNumber")
  THEN RAISE EXCEPTION 'Paid payment receipts are immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
COMMIT;
