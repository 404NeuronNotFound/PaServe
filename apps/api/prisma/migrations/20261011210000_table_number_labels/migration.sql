-- Retain IDs, codes, status and timestamps while converting existing numeric labels.
ALTER TABLE "restaurant_tables" DROP CONSTRAINT "restaurant_tables_number_range";
ALTER TABLE "restaurant_tables" ALTER COLUMN "number" TYPE VARCHAR(40) USING "number"::text;
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_number_nonempty"
  CHECK (char_length(btrim("number")) BETWEEN 1 AND 40);
-- Prevent ambiguous human-facing labels such as A3 and a3 within a shop.
CREATE UNIQUE INDEX "restaurant_tables_shopId_number_casefold_key"
  ON "restaurant_tables" ("shopId", lower("number"));
