BEGIN;

-- Existing options remain unchanged until an owner chooses their default.
ALTER TABLE "product_variants" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_default_base_price"
  CHECK (NOT "isDefault" OR "priceAdjustment" = 0);
-- SQL-maintained: one base/default choice per group, including ungrouped options.
CREATE UNIQUE INDEX "product_variants_default_choice_key"
  ON "product_variants"("productId", COALESCE("optionGroupId", '')) WHERE "isDefault";

COMMIT;
