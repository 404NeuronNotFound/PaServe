ALTER TABLE "products" ADD COLUMN "featuredSortOrder" INTEGER NOT NULL DEFAULT 2147483647;

-- Preserve the existing public featured order during the upgrade.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "shopId" ORDER BY "sortOrder", "createdAt", "id"
  ) - 1 AS position
  FROM "products" WHERE "isFeatured" = true AND "isArchived" = false
)
UPDATE "products" SET "featuredSortOrder" = ranked.position
FROM ranked WHERE "products"."id" = ranked."id";
