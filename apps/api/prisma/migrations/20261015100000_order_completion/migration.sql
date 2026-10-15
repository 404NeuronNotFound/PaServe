BEGIN;
ALTER TABLE orders ADD COLUMN "completedAt" TIMESTAMP(3), ADD COLUMN "completedBy" TEXT;
ALTER TABLE orders DROP CONSTRAINT orders_preparation_check;
ALTER TABLE orders ADD CONSTRAINT orders_preparation_check CHECK (
  ("preparationStatus" IS NULL AND "queuedAt" IS NULL) OR
  ("preparationStatus" IS NOT NULL AND "preparationStatus" IN ('QUEUED', 'PREPARING', 'READY', 'COMPLETED')
    AND "queuedAt" IS NOT NULL AND status = 'CONFIRMED' AND "paymentStatus" = 'PAID'
    AND "paidAt" IS NOT NULL AND "queuedAt" >= "paidAt")
);
ALTER TABLE orders DROP CONSTRAINT orders_preparation_start_check;
ALTER TABLE orders ADD CONSTRAINT orders_preparation_start_check CHECK (
  ("preparationStartedAt" IS NULL AND "preparationStartedBy" IS NULL) OR
  ("preparationStartedAt" IS NOT NULL AND "preparationStartedBy" IS NOT NULL
    AND length("preparationStartedBy") > 0 AND "preparationStatus" IS NOT NULL
    AND "preparationStatus" IN ('PREPARING', 'READY', 'COMPLETED')
    AND "queuedAt" IS NOT NULL AND "preparationStartedAt" >= "queuedAt")
);
ALTER TABLE orders DROP CONSTRAINT orders_preparation_ready_check;
ALTER TABLE orders ADD CONSTRAINT orders_preparation_ready_check CHECK (
  ("preparationReadyAt" IS NULL AND "preparationReadyBy" IS NULL) OR
  ("preparationReadyAt" IS NOT NULL AND "preparationReadyBy" IS NOT NULL
    AND length("preparationReadyBy") > 0 AND "preparationStatus" IS NOT NULL
    AND "preparationStatus" IN ('READY', 'COMPLETED') AND "preparationStartedAt" IS NOT NULL
    AND "preparationStartedBy" IS NOT NULL AND "preparationReadyAt" >= "preparationStartedAt")
);
ALTER TABLE orders ADD CONSTRAINT orders_completion_check CHECK (
  ("preparationStatus" IS DISTINCT FROM 'COMPLETED' AND "completedAt" IS NULL AND "completedBy" IS NULL) OR
  ("preparationStatus" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "completedBy" IS NOT NULL
    AND length("completedBy") > 0 AND "preparationReadyAt" IS NOT NULL AND "preparationReadyBy" IS NOT NULL
    AND "preparationStartedAt" IS NOT NULL AND "preparationStartedBy" IS NOT NULL
    AND "completedAt" >= "preparationReadyAt")
);
CREATE OR REPLACE FUNCTION protect_order_queue() RETURNS trigger LANGUAGE plpgsql AS $$
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
         (OLD."preparationStatus" = 'PREPARING' AND NEW."preparationStatus" = 'READY') OR
         (OLD."preparationStatus" = 'READY' AND NEW."preparationStatus" = 'COMPLETED')) THEN
      RAISE EXCEPTION 'Queue entry is immutable and fulfillment only moves forward' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION protect_order_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."completedAt" IS NOT NULL OR NEW."completedBy" IS NOT NULL THEN
      RAISE EXCEPTION 'Completion must follow a saved ready order' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."preparationStatus" = 'READY' AND NEW."preparationStatus" = 'COMPLETED' THEN
    IF NEW."completedAt" IS NULL OR NEW."completedBy" IS NULL THEN
      RAISE EXCEPTION 'Completion metadata is required' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."completedAt" IS DISTINCT FROM OLD."completedAt" OR NEW."completedBy" IS DISTINCT FROM OLD."completedBy" THEN
    RAISE EXCEPTION 'Completion metadata is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_completion_guard BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION protect_order_completion();
CREATE INDEX "orders_shopId_preparationStatus_completedAt_id_idx" ON orders ("shopId", "preparationStatus", "completedAt", id);
COMMIT;
