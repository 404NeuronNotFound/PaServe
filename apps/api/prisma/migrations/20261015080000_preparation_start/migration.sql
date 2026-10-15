BEGIN;
ALTER TABLE orders
  ADD COLUMN "preparationStartedAt" TIMESTAMP(3),
  ADD COLUMN "preparationStartedBy" TEXT;
-- Historical preparation records may have no start metadata. Never invent it.
ALTER TABLE orders ADD CONSTRAINT orders_preparation_start_check CHECK (
  ("preparationStartedAt" IS NULL AND "preparationStartedBy" IS NULL) OR
  ("preparationStartedAt" IS NOT NULL AND "preparationStartedBy" IS NOT NULL
    AND length("preparationStartedBy") > 0 AND "preparationStatus" IS NOT NULL
    AND "preparationStatus" IN ('PREPARING', 'READY')
    AND "queuedAt" IS NOT NULL AND "preparationStartedAt" >= "queuedAt")
);
CREATE FUNCTION protect_preparation_start() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."preparationStartedAt" IS NOT NULL OR NEW."preparationStartedBy" IS NOT NULL THEN
      RAISE EXCEPTION 'Preparation must start from a saved queued order' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."preparationStatus" = 'QUEUED' AND NEW."preparationStatus" = 'PREPARING' THEN
    IF NEW."preparationStartedAt" IS NULL OR NEW."preparationStartedBy" IS NULL THEN
      RAISE EXCEPTION 'Preparation start metadata is required' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."preparationStartedAt" IS DISTINCT FROM OLD."preparationStartedAt" OR
        NEW."preparationStartedBy" IS DISTINCT FROM OLD."preparationStartedBy" THEN
    RAISE EXCEPTION 'Preparation start metadata is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_preparation_start_guard BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION protect_preparation_start();
COMMIT;
