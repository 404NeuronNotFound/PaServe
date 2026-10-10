BEGIN;
CREATE TABLE "add_ons" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "add_ons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "add_ons_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "add_ons_price_nonnegative" CHECK ("priceAdjustment" >= 0 AND "priceAdjustment" <> 'NaN'::numeric),
  CONSTRAINT "add_ons_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  CONSTRAINT "add_ons_sort_check" CHECK ("sortOrder" BETWEEN 0 AND 1000000)
);
CREATE UNIQUE INDEX "add_ons_id_shopId_key" ON "add_ons"("id", "shopId");
CREATE UNIQUE INDEX "add_ons_shopId_name_key" ON "add_ons"("shopId", "name");
CREATE INDEX "add_ons_shopId_idx" ON "add_ons"("shopId");

CREATE TABLE "product_add_ons" (
  "shopId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "addOnId" TEXT NOT NULL,
  CONSTRAINT "product_add_ons_pkey" PRIMARY KEY ("productId", "addOnId"),
  CONSTRAINT "product_add_ons_productId_shopId_fkey" FOREIGN KEY ("productId", "shopId")
    REFERENCES "products"("id", "shopId") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "product_add_ons_addOnId_shopId_fkey" FOREIGN KEY ("addOnId", "shopId")
    REFERENCES "add_ons"("id", "shopId") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "product_add_ons_shopId_productId_idx" ON "product_add_ons"("shopId", "productId");
CREATE INDEX "product_add_ons_addOnId_shopId_idx" ON "product_add_ons"("addOnId", "shopId");

ALTER TABLE "add_ons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_add_ons" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "add_ons", "product_add_ons" FROM anon, authenticated;
COMMIT;
