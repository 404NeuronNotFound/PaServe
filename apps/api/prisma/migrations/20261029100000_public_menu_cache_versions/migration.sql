BEGIN;
-- Separate from shops so catalog invalidation does not contend on the checkout
-- shop/counter row. Epoch UUIDs prevent reuse across resets or recreated shops.
CREATE TABLE public.menu_cache_versions (
  "shopId" TEXT PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  version TEXT NOT NULL DEFAULT gen_random_uuid()::text
);
ALTER TABLE public.menu_cache_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_cache_versions FROM anon, authenticated;
GRANT SELECT ON public.menu_cache_versions TO service_role;
INSERT INTO public.menu_cache_versions ("shopId") SELECT id FROM public.shops;

CREATE FUNCTION public.initialize_menu_cache_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.menu_cache_versions ("shopId") VALUES (NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER shops_menu_cache_version AFTER INSERT ON public.shops
FOR EACH ROW EXECUTE FUNCTION public.initialize_menu_cache_version();

CREATE FUNCTION public.invalidate_menu_cache_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.menu_cache_versions ("shopId",version)
      SELECT changed."shopId",gen_random_uuid()::text FROM (SELECT DISTINCT "shopId" FROM menu_new) changed
      JOIN public.shops s ON s.id=changed."shopId" ORDER BY changed."shopId"
      ON CONFLICT ("shopId") DO UPDATE SET version=EXCLUDED.version;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.menu_cache_versions ("shopId",version)
      SELECT changed."shopId",gen_random_uuid()::text FROM (SELECT DISTINCT "shopId" FROM menu_old) changed
      JOIN public.shops s ON s.id=changed."shopId" ORDER BY changed."shopId"
      ON CONFLICT ("shopId") DO UPDATE SET version=EXCLUDED.version;
  ELSE
    INSERT INTO public.menu_cache_versions ("shopId",version)
      SELECT changed."shopId",gen_random_uuid()::text FROM (SELECT "shopId" FROM menu_old UNION SELECT "shopId" FROM menu_new) changed
      JOIN public.shops s ON s.id=changed."shopId" ORDER BY changed."shopId"
      ON CONFLICT ("shopId") DO UPDATE SET version=EXCLUDED.version;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER products_menu_cache_insert AFTER INSERT ON public.products REFERENCING NEW TABLE AS menu_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_menu_cache_version();
CREATE TRIGGER products_menu_cache_update AFTER UPDATE ON public.products REFERENCING OLD TABLE AS menu_old NEW TABLE AS menu_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_menu_cache_version();
CREATE TRIGGER products_menu_cache_delete AFTER DELETE ON public.products REFERENCING OLD TABLE AS menu_old
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_menu_cache_version();
CREATE TRIGGER categories_menu_cache_insert AFTER INSERT ON public.categories REFERENCING NEW TABLE AS menu_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_menu_cache_version();
CREATE TRIGGER categories_menu_cache_update AFTER UPDATE ON public.categories REFERENCING OLD TABLE AS menu_old NEW TABLE AS menu_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_menu_cache_version();
CREATE TRIGGER categories_menu_cache_delete AFTER DELETE ON public.categories REFERENCING OLD TABLE AS menu_old
  FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_menu_cache_version();
REVOKE ALL ON FUNCTION public.initialize_menu_cache_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invalidate_menu_cache_version() FROM PUBLIC;
COMMIT;
