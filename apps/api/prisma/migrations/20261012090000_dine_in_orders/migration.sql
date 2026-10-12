CREATE TYPE "OrderMode" AS ENUM ('DINE_IN');
CREATE UNIQUE INDEX "restaurant_tables_id_shopId_key" ON "restaurant_tables"("id", "shopId");
CREATE TABLE "orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL REFERENCES "shops"("id") ON DELETE RESTRICT,
  "tableId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "mode" "OrderMode" NOT NULL DEFAULT 'DINE_IN',
  "status" TEXT NOT NULL DEFAULT 'PLACED' CHECK ("status" = 'PLACED'),
  "tableCode" TEXT NOT NULL,
  "tableNumber" VARCHAR(40) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'PHP' CHECK ("currency" = 'PHP'),
  "totalPrice" DECIMAL(12,2) NOT NULL CHECK ("totalPrice" >= 0),
  "items" JSONB NOT NULL CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") BETWEEN 1 AND 100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_tableId_shopId_fkey" FOREIGN KEY ("tableId", "shopId") REFERENCES "restaurant_tables"("id", "shopId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "orders_shopId_requestId_key" ON "orders"("shopId", "requestId");
CREATE INDEX "orders_shopId_tableId_createdAt_idx" ON "orders"("shopId", "tableId", "createdAt");
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "orders" FROM anon, authenticated;
