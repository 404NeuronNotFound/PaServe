CREATE TYPE "DineInServiceType" AS ENUM ('TABLE_SERVICE', 'COUNTER_PICKUP');
CREATE TYPE "DineInServiceMode" AS ENUM ('BOTH', 'TABLE_SERVICE', 'COUNTER_PICKUP');

ALTER TABLE "shops" ADD COLUMN "dineInServiceMode" "DineInServiceMode" NOT NULL DEFAULT 'BOTH';
ALTER TABLE "orders" ADD COLUMN "serviceType" "DineInServiceType";
UPDATE "orders" SET "serviceType" = 'TABLE_SERVICE' WHERE "mode" = 'DINE_IN';
ALTER TABLE "orders" ADD CONSTRAINT "orders_mode_service_binding" CHECK (
  ("mode" = 'DINE_IN' AND "serviceType" IS NOT NULL)
  OR ("mode" = 'TAKEOUT' AND "serviceType" IS NULL)
);

-- Older API instances omit this new field during a rolling deployment.
CREATE FUNCTION public.initialize_order_service_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."mode" = 'DINE_IN' AND NEW."serviceType" IS NULL THEN
    NEW."serviceType" := 'TABLE_SERVICE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_service_type_default BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.initialize_order_service_type();

CREATE FUNCTION public.preserve_order_service_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."serviceType" IS DISTINCT FROM OLD."serviceType" THEN
    RAISE EXCEPTION 'Order service type is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_service_type_immutable BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.preserve_order_service_type();
