BEGIN;

CREATE UNIQUE INDEX "products_id_shopId_key" ON "products"("id", "shopId");

CREATE TABLE "product_option_groups" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_option_groups_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  CONSTRAINT "product_option_groups_sort_check" CHECK ("sortOrder" BETWEEN 0 AND 1000000),
  CONSTRAINT "product_option_groups_productId_shopId_fkey" FOREIGN KEY ("productId", "shopId")
    REFERENCES "products"("id", "shopId") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "product_option_groups_id_shopId_key" ON "product_option_groups"("id", "shopId");
CREATE UNIQUE INDEX "product_option_groups_id_productId_shopId_key" ON "product_option_groups"("id", "productId", "shopId");
CREATE UNIQUE INDEX "product_option_groups_productId_name_key" ON "product_option_groups"("productId", "name");
CREATE INDEX "product_option_groups_shopId_productId_idx" ON "product_option_groups"("shopId", "productId");

CREATE TABLE "product_variants" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "optionGroupId" TEXT,
  "name" TEXT NOT NULL,
  "priceAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_variants_price_nonnegative" CHECK ("priceAdjustment" >= 0 AND "priceAdjustment" <> 'NaN'::numeric),
  CONSTRAINT "product_variants_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  CONSTRAINT "product_variants_sort_check" CHECK ("sortOrder" BETWEEN 0 AND 1000000),
  CONSTRAINT "product_variants_productId_shopId_fkey" FOREIGN KEY ("productId", "shopId")
    REFERENCES "products"("id", "shopId") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "product_variants_optionGroupId_productId_shopId_fkey" FOREIGN KEY ("optionGroupId", "productId", "shopId")
    REFERENCES "product_option_groups"("id", "productId", "shopId") ON DELETE NO ACTION ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "product_variants_id_shopId_key" ON "product_variants"("id", "shopId");
CREATE INDEX "product_variants_shopId_productId_optionGroupId_idx" ON "product_variants"("shopId", "productId", "optionGroupId");
-- SQL-maintained: prevent duplicate names in the implicit ungrouped choice, too.
CREATE UNIQUE INDEX "product_variants_choice_name_key" ON "product_variants"("productId", COALESCE("optionGroupId", ''), lower("name"));

ALTER TABLE "product_option_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "product_option_groups", "product_variants" FROM anon, authenticated;

COMMIT;
