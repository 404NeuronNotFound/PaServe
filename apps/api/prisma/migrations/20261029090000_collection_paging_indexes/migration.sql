-- LIMIT + deterministic catalog ordering now justify these indexes. The earlier
-- unbounded full-list benchmark correctly did not retain them.
-- Standard builds block writes; apply before traffic or in a maintenance window.
BEGIN;
CREATE INDEX "categories_shop_page_idx" ON categories ("shopId", "sortOrder", "createdAt", id);
CREATE INDEX "products_shop_page_idx" ON products ("shopId", "sortOrder", "createdAt", id);
COMMIT;
