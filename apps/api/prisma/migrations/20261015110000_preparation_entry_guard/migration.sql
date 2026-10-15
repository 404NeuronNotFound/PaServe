BEGIN;
-- Legacy paid receipts have no queuedAt. Their first preparation state must
-- still be QUEUED; nullable historical timestamps must not permit a shortcut.
CREATE OR REPLACE FUNCTION protect_order_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW."paymentStatus" = 'PAID') OR
     (TG_OP = 'UPDATE' AND OLD."paymentStatus" <> 'PAID' AND NEW."paymentStatus" = 'PAID') THEN
    IF NEW."preparationStatus" IS DISTINCT FROM 'QUEUED' OR NEW."queuedAt" IS NULL THEN
      RAISE EXCEPTION 'New payment must enter the preparation queue' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."queuedAt" IS NULL AND NEW."queuedAt" IS NOT NULL
     AND NEW."preparationStatus" IS DISTINCT FROM 'QUEUED' THEN
    RAISE EXCEPTION 'Preparation must enter QUEUED first' USING ERRCODE = '23514';
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
COMMIT;
