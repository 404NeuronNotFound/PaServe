ALTER TABLE "shops" ADD COLUMN "accentColor" VARCHAR(7);
ALTER TABLE "shops" ADD CONSTRAINT "shops_accent_color_hex"
  CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9A-F]{6}$');
