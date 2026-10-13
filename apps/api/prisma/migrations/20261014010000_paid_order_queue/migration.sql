BEGIN;
ALTER TABLE orders
  ADD COLUMN "preparationStatus" TEXT,
  ADD COLUMN "queuedAt" TIMESTAMP(3);
ALTER TABLE orders ADD CONSTRAINT orders_preparation_check CHECK (
  ("preparationStatus" IS NULL AND "queuedAt" IS NULL) OR
  ("preparationStatus" IS NOT NULL AND "preparationStatus" IN ('QUEUED', 'PREPARING', 'READY')
    AND "queuedAt" IS NOT NULL AND status = 'CONFIRMED' AND "paymentStatus" = 'PAID'
    AND "paidAt" IS NOT NULL AND "queuedAt" >= "paidAt")
);
CREATE INDEX "orders_shopId_preparationStatus_queuedAt_id_idx"
  ON orders ("shopId", "preparationStatus", "queuedAt", id);
-- Historical paid receipts are intentionally not enqueued retroactively.
CREATE FUNCTION protect_order_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW."paymentStatus" = 'PAID') OR
     (TG_OP = 'UPDATE' AND OLD."paymentStatus" <> 'PAID' AND NEW."paymentStatus" = 'PAID') THEN
    IF NEW."preparationStatus" IS DISTINCT FROM 'QUEUED' OR NEW."queuedAt" IS NULL THEN
      RAISE EXCEPTION 'New payment must enter the preparation queue' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."queuedAt" IS NOT NULL THEN
    IF NEW."queuedAt" IS DISTINCT FROM OLD."queuedAt" OR
       NOT (NEW."preparationStatus" IS NOT DISTINCT FROM OLD."preparationStatus" OR
         (OLD."preparationStatus" = 'QUEUED' AND NEW."preparationStatus" = 'PREPARING') OR
         (OLD."preparationStatus" = 'PREPARING' AND NEW."preparationStatus" = 'READY')) THEN
      RAISE EXCEPTION 'Queue entry is immutable and preparation only moves forward' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_queue_guard BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION protect_order_queue();
COMMIT;
