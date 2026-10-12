ALTER TABLE "orders"
  ALTER COLUMN "tableId" DROP NOT NULL,
  ALTER COLUMN "tableCode" DROP NOT NULL,
  ALTER COLUMN "tableNumber" DROP NOT NULL;

ALTER TABLE "orders" ADD CONSTRAINT "orders_mode_table_binding" CHECK (
  ("mode"::text = 'DINE_IN' AND "tableId" IS NOT NULL AND "tableCode" IS NOT NULL AND "tableNumber" IS NOT NULL)
  OR
  ("mode"::text = 'TAKEOUT' AND "tableId" IS NULL AND "tableCode" IS NULL AND "tableNumber" IS NULL)
);
