ALTER TABLE "shops" ADD COLUMN "lastOrderNumber" BIGINT NOT NULL DEFAULT 0 CHECK ("lastOrderNumber" >= 0);
ALTER TABLE "orders" ADD COLUMN "orderNumber" VARCHAR(32);
WITH numbered AS (
  SELECT "id", row_number() OVER (PARTITION BY "shopId" ORDER BY "createdAt", "id") AS n FROM "orders"
)
UPDATE "orders" o SET "orderNumber" = 'ORD-' || CASE WHEN length(n.n::text) < 6 THEN lpad(n.n::text, 6, '0') ELSE n.n::text END
FROM numbered n WHERE o."id" = n."id";
UPDATE "shops" s SET "lastOrderNumber" = counts.n
FROM (SELECT "shopId", count(*)::bigint AS n FROM "orders" GROUP BY "shopId") counts WHERE s."id" = counts."shopId";
ALTER TABLE "orders" ALTER COLUMN "orderNumber" SET NOT NULL;
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_format" CHECK ("orderNumber" ~ '^ORD-[0-9]{6,19}$');
CREATE UNIQUE INDEX "orders_shopId_orderNumber_key" ON "orders"("shopId", "orderNumber");
ALTER TABLE "orders" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID' CHECK ("paymentStatus" = 'UNPAID');
ALTER TABLE "orders" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "orders" SET "updatedAt" = "createdAt";
ALTER TABLE "orders" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "orders" ADD COLUMN "qrTokenNonce" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "orders" ALTER COLUMN "qrTokenNonce" DROP DEFAULT;
ALTER TABLE "orders" ADD COLUMN "qrTokenExpiresAt" TIMESTAMP(3);
UPDATE "orders" SET "qrTokenExpiresAt" = "createdAt" + INTERVAL '7 days';
ALTER TABLE "orders" ALTER COLUMN "qrTokenExpiresAt" SET NOT NULL;
ALTER TABLE "orders" ADD COLUMN "qrTokenRevokedAt" TIMESTAMP(3);
