ALTER TABLE "order_items"
  ADD COLUMN "productSnapshotId" TEXT,
  ADD COLUMN "productNameSnapshot" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'PHP',
  ADD COLUMN "basePriceSnapshot" DECIMAL(10,2),
  ADD COLUMN "unitPriceSnapshot" DECIMAL(12,2),
  ADD COLUMN "lineTotalSnapshot" DECIMAL(12,2),
  ADD COLUMN "variantsSnapshot" JSONB,
  ADD COLUMN "addOnsSnapshot" JSONB;
UPDATE "order_items" SET
  "productSnapshotId" = "snapshot"->>'productId',
  "productNameSnapshot" = "snapshot"->>'productName',
  "currency" = "snapshot"->>'currency',
  "basePriceSnapshot" = ("snapshot"->>'basePrice')::numeric,
  "unitPriceSnapshot" = ("snapshot"->>'unitPrice')::numeric,
  "lineTotalSnapshot" = ("snapshot"->>'totalPrice')::numeric,
  "variantsSnapshot" = "snapshot"->'variants',
  "addOnsSnapshot" = "snapshot"->'addOns';
ALTER TABLE "order_items"
  ALTER COLUMN "productSnapshotId" SET NOT NULL,
  ALTER COLUMN "productNameSnapshot" SET NOT NULL,
  ALTER COLUMN "basePriceSnapshot" SET NOT NULL,
  ALTER COLUMN "unitPriceSnapshot" SET NOT NULL,
  ALTER COLUMN "lineTotalSnapshot" SET NOT NULL,
  ALTER COLUMN "variantsSnapshot" SET NOT NULL,
  ALTER COLUMN "addOnsSnapshot" SET NOT NULL;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_snapshot_money" CHECK (
  "currency" = 'PHP' AND "basePriceSnapshot" >= 0 AND "unitPriceSnapshot" >= 0
  AND "lineTotalSnapshot" = "unitPriceSnapshot" * "quantity"
);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_snapshot_fields" CHECK (
  "snapshot" ?& ARRAY['productName', 'currency', 'basePrice', 'unitPrice', 'totalPrice', 'variants', 'addOns']
  AND length("productSnapshotId") > 0 AND length("productNameSnapshot") > 0
  AND "productSnapshotId" = "snapshot"->>'productId'
  AND "productNameSnapshot" = "snapshot"->>'productName'
  AND "currency" = "snapshot"->>'currency'
  AND "basePriceSnapshot" = ("snapshot"->>'basePrice')::numeric
  AND "unitPriceSnapshot" = ("snapshot"->>'unitPrice')::numeric
  AND "lineTotalSnapshot" = ("snapshot"->>'totalPrice')::numeric
  AND jsonb_typeof("variantsSnapshot") = 'array' AND jsonb_typeof("addOnsSnapshot") = 'array'
  AND "variantsSnapshot" = "snapshot"->'variants' AND "addOnsSnapshot" = "snapshot"->'addOns'
);
