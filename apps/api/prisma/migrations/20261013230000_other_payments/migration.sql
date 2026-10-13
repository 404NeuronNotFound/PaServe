BEGIN;
ALTER TABLE orders ADD COLUMN "paymentDescription" VARCHAR(80);
ALTER TABLE orders DROP CONSTRAINT "orders_cash_payment_check";
ALTER TABLE orders ADD CONSTRAINT "orders_cash_payment_check" CHECK (
  ("paymentStatus" = 'UNPAID' AND "paymentMethod" IS NULL AND "paymentRequestId" IS NULL
    AND "paymentReviewVersion" IS NULL AND "amountReceived" IS NULL AND "changeDue" IS NULL
    AND "paidAt" IS NULL AND "paidBy" IS NULL)
  OR
  ("paymentStatus" = 'PAID' AND status = 'CONFIRMED' AND currency = 'PHP'
    AND "paymentMethod" IS NOT NULL AND "paymentMethod" IN ('CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER')
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
  ("paymentStatus" = 'PAID' AND "paymentMethod" IN ('GCASH_MANUAL', 'CARD_MANUAL', 'OTHER')
    AND length(btrim("paymentReference")) BETWEEN 1 AND 200
    AND "paymentReference" !~ '[[:cntrl:]<>]')
);
ALTER TABLE orders ADD CONSTRAINT orders_other_payment_check CHECK (
  ("paymentDescription" IS NULL AND "paymentMethod" IS DISTINCT FROM 'OTHER') OR
  ("paymentMethod" = 'OTHER' AND "paymentStatus" = 'PAID' AND "paymentDescription" IS NOT NULL
    AND length(btrim("paymentDescription")) BETWEEN 1 AND 80
    AND "paymentDescription" !~ '[[:cntrl:]<>]'
    AND "paymentDescription" !~ '[0-9]([ -]*[0-9]){12}'
    AND "paymentDescription" !~* '\m(cvv|cvc|pan|pin|expiry|expiration|security[ -]*code)\M'
    AND ("paymentReference" IS NULL OR
      ("paymentReference" !~ '[0-9]([ -]*[0-9]){12}'
       AND "paymentReference" !~* '\m(cvv|cvc|pan|pin|expiry|expiration|security[ -]*code)\M')))
);
CREATE OR REPLACE FUNCTION protect_cash_payment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."paymentStatus" = 'PAID' AND
    ROW(NEW."paymentStatus", NEW."paymentMethod", NEW."paymentRequestId", NEW."paymentReviewVersion", NEW."paymentReference", NEW."paymentDescription",
        NEW."amountReceived", NEW."changeDue", NEW."paidAt", NEW."paidBy", NEW."totalPrice", NEW.currency, NEW.status, NEW."shopId", NEW.id, NEW."orderNumber")
    IS DISTINCT FROM
    ROW(OLD."paymentStatus", OLD."paymentMethod", OLD."paymentRequestId", OLD."paymentReviewVersion", OLD."paymentReference", OLD."paymentDescription",
        OLD."amountReceived", OLD."changeDue", OLD."paidAt", OLD."paidBy", OLD."totalPrice", OLD.currency, OLD.status, OLD."shopId", OLD.id, OLD."orderNumber")
  THEN RAISE EXCEPTION 'Paid payment receipts are immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
COMMIT;
