CREATE TABLE "restaurant_tables" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "restaurant_tables_number_range" CHECK ("number" BETWEEN 1 AND 9999),
    CONSTRAINT "restaurant_tables_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "restaurant_tables_shopId_number_key" ON "restaurant_tables"("shopId", "number");
CREATE UNIQUE INDEX "restaurant_tables_shopId_code_key" ON "restaurant_tables"("shopId", "code");
ALTER TABLE "restaurant_tables" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "restaurant_tables" FROM anon, authenticated;
