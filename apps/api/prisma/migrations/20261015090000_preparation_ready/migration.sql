BEGIN;
ALTER TABLE orders
  ADD COLUMN "preparationReadyAt" TIMESTAMP(3),
  ADD COLUMN "preparationReadyBy" TEXT;
-- Retain historical records without inventing readiness timestamps.
ALTER TABLE orders ADD CONSTRAINT orders_preparation_ready_check CHECK (
  ("preparationReadyAt" IS NULL AND "preparationReadyBy" IS NULL) OR
  ("preparationReadyAt" IS NOT NULL AND "preparationReadyBy" IS NOT NULL
    AND length("preparationReadyBy") > 0 AND "preparationStatus" IS NOT NULL
    AND "preparationStatus" = 'READY' AND "preparationStartedAt" IS NOT NULL
    AND "preparationStartedBy" IS NOT NULL AND "preparationReadyAt" >= "preparationStartedAt")
);
CREATE FUNCTION protect_preparation_ready() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."preparationReadyAt" IS NOT NULL OR NEW."preparationReadyBy" IS NOT NULL THEN
      RAISE EXCEPTION 'Readiness must follow saved preparation' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."preparationStatus" = 'PREPARING' AND NEW."preparationStatus" = 'READY' THEN
    IF NEW."preparationReadyAt" IS NULL OR NEW."preparationReadyBy" IS NULL THEN
      RAISE EXCEPTION 'Preparation readiness metadata is required' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."preparationReadyAt" IS DISTINCT FROM OLD."preparationReadyAt" OR
        NEW."preparationReadyBy" IS DISTINCT FROM OLD."preparationReadyBy" THEN
    RAISE EXCEPTION 'Preparation readiness metadata is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_preparation_ready_guard BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION protect_preparation_ready();
COMMIT;
