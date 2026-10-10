ALTER TABLE "shops" ADD COLUMN "primaryColor" VARCHAR(7);
ALTER TABLE "shops" ADD CONSTRAINT "shops_primary_color_hex"
  CHECK ("primaryColor" IS NULL OR "primaryColor" ~ '^#[0-9A-F]{6}$');
