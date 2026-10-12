CREATE UNIQUE INDEX "orders_id_shopId_key" ON "orders"("id", "shopId");
CREATE TABLE "order_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "lineNumber" INTEGER NOT NULL CHECK ("lineNumber" BETWEEN 1 AND 100),
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 99),
  "notes" VARCHAR(300),
  "snapshot" JSONB NOT NULL CHECK (
    jsonb_typeof("snapshot") = 'object' AND "snapshot" ?& ARRAY['productId', 'quantity']
    AND jsonb_typeof("snapshot"->'productId') = 'string'
    AND jsonb_typeof("snapshot"->'quantity') = 'number'
    AND ("snapshot"->>'quantity')::integer = "quantity"
    AND ("productId" IS NULL OR "snapshot"->>'productId' = "productId")
  ),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_items_orderId_shopId_fkey" FOREIGN KEY ("orderId", "shopId") REFERENCES "orders"("id", "shopId") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "order_items_productId_shopId_fkey" FOREIGN KEY ("productId", "shopId") REFERENCES "products"("id", "shopId") ON DELETE SET NULL ("productId") ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "order_items_orderId_lineNumber_key" ON "order_items"("orderId", "lineNumber");
CREATE INDEX "order_items_shopId_orderId_idx" ON "order_items"("shopId", "orderId");
INSERT INTO "order_items" ("id", "shopId", "orderId", "productId", "lineNumber", "quantity", "notes", "snapshot", "createdAt")
SELECT gen_random_uuid()::text, o."shopId", o."id", p."id", line.position::integer, (line.item->>'quantity')::integer, line.item->>'notes', line.item, o."createdAt"
FROM "orders" o CROSS JOIN LATERAL jsonb_array_elements(o."items") WITH ORDINALITY AS line(item, position)
LEFT JOIN "products" p ON p."id" = line.item->>'productId' AND p."shopId" = o."shopId";
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "order_items" FROM anon, authenticated;
