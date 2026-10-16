-- Existing orders have no historical shop identity; do not backfill from current settings.
ALTER TABLE public.orders ADD COLUMN "shopDetailsSnapshot" jsonb;

-- Protect the snapshot throughout the order lifecycle, including before payment.
CREATE FUNCTION public.preserve_order_shop_details() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."shopDetailsSnapshot" IS DISTINCT FROM OLD."shopDetailsSnapshot" THEN
    RAISE EXCEPTION 'Receipt shop details are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_shop_details_immutable BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.preserve_order_shop_details();
