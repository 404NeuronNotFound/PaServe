-- Prisma cannot represent CHECK constraints. Preserve this in future migrations.
ALTER TABLE "products" ADD CONSTRAINT "products_price_nonnegative"
CHECK ("price" >= 0 AND "price" <= 99999999.99);
