CREATE FUNCTION public.broadcast_product_available()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE shop_slug text;
BEGIN
  IF OLD.status IN ('SOLD_OUT', 'HIDDEN') AND NEW.status = 'AVAILABLE'
     AND NOT NEW."isArchived" AND OLD."shopId" = NEW."shopId"
     AND (NEW."categoryId" IS NULL OR EXISTS (
       SELECT 1 FROM public.categories c WHERE c.id = NEW."categoryId"
         AND c."shopId" = NEW."shopId" AND c."isVisible"
     )) THEN
    SELECT s.slug INTO shop_slug FROM public.shops s WHERE s.id = NEW."shopId" AND s."isActive";
    IF shop_slug IS NOT NULL THEN
      PERFORM realtime.send(jsonb_build_object('shopSlug', shop_slug),
        'product_available', 'menu:availability:' || NEW."shopId" || ':' || shop_slug, true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_product_available() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER products_broadcast_available AFTER UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_available();

-- Reuse menu_availability_backend_only from the sold-out migration.
