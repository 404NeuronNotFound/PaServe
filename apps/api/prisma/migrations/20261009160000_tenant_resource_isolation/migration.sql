BEGIN;

-- Category access, like products/shops, is owned by authenticated NestJS routes.
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.categories FROM anon, authenticated;

-- Refuse to apply over existing cross-tenant links; do not silently move data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.categories c ON c.id = p."categoryId"
    WHERE p."shopId" <> c."shopId"
  ) THEN
    RAISE EXCEPTION 'Existing product/category links cross shop boundaries';
  END IF;
END $$;

CREATE UNIQUE INDEX "categories_id_shopId_key" ON public.categories(id, "shopId");

-- SQL-maintained constraint: Prisma cannot express SET NULL for only one column
-- of a composite foreign key. Preserve the required product.shopId on deletion.
-- RESTRICT prevents moving a referenced category to another shop.
ALTER TABLE public.products
  ADD CONSTRAINT "products_category_tenant_fkey"
  FOREIGN KEY ("categoryId", "shopId") REFERENCES public.categories(id, "shopId")
  ON DELETE SET NULL ("categoryId") ON UPDATE RESTRICT;

COMMIT;
