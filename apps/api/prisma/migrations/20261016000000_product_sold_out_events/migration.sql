CREATE FUNCTION public.broadcast_product_sold_out()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE shop_slug text;
BEGIN
  IF OLD.status = 'AVAILABLE' AND NEW.status = 'SOLD_OUT'
     AND NOT NEW."isArchived" AND OLD."shopId" = NEW."shopId"
     AND (NEW."categoryId" IS NULL OR EXISTS (
       SELECT 1 FROM public.categories c WHERE c.id = NEW."categoryId"
         AND c."shopId" = NEW."shopId" AND c."isVisible"
     )) THEN
    SELECT s.slug INTO shop_slug FROM public.shops s WHERE s.id = NEW."shopId" AND s."isActive";
    IF shop_slug IS NOT NULL THEN
      PERFORM realtime.send(jsonb_build_object('shopSlug', shop_slug),
        'product_sold_out', 'menu:availability:' || NEW."shopId" || ':' || shop_slug, true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_product_sold_out() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER products_broadcast_sold_out AFTER UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_sold_out();

CREATE POLICY menu_availability_backend_only ON realtime.messages
AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (topic NOT LIKE 'menu:availability:%')
WITH CHECK (topic NOT LIKE 'menu:availability:%');
