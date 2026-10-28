-- Tenant equality leads each index; trailing IDs preserve deterministic sorting.
-- Additive only: retain existing unique, idempotency, queue and tenant FK indexes.
-- Standard CREATE INDEX takes a write lock. Deploy before traffic, or schedule
-- a maintenance window for populated installations (see docs/database-indexing.md).
BEGIN;
CREATE INDEX "orders_shop_status_created_idx"
  ON "orders" ("shopId", "status", "createdAt", "id");
CREATE INDEX "products_shop_category_sort_idx"
  ON "products" ("shopId", "categoryId", "isArchived", "sortOrder", "createdAt", "id");
COMMIT;
