-- Retain product identity and relations; archived products are excluded from public menus.
ALTER TABLE "products" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
