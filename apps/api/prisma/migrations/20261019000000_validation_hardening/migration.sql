BEGIN;

-- Durable structural invariants. Keep in sync with SHOP/CATEGORY/PRODUCT_LIMITS.
-- Preserve existing composite tenant FKs, RLS and all price/order constraints.
-- No data rewriting: invalid legacy rows must be reviewed before deployment.
ALTER TABLE "shops" ADD CONSTRAINT "shops_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 120 AND char_length(btrim("name")) > 0);
ALTER TABLE "shops" ADD CONSTRAINT "shops_description_length_check"
  CHECK ("description" IS NULL OR char_length("description") <= 1000);
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 80 AND char_length(btrim("name")) > 0);
ALTER TABLE "categories" ADD CONSTRAINT "categories_description_length_check"
  CHECK ("description" IS NULL OR char_length("description") <= 500);
ALTER TABLE "products" ADD CONSTRAINT "products_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 120 AND char_length(btrim("name")) > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_description_length_check"
  CHECK ("description" IS NULL OR char_length("description") <= 2000);
ALTER TABLE "products" ADD CONSTRAINT "products_sort_order_nonnegative"
  CHECK ("sortOrder" >= 0 AND "featuredSortOrder" >= 0);

COMMIT;
