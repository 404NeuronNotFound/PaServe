CREATE TYPE "MenuLayout" AS ENUM ('grid', 'list', 'compact');
ALTER TABLE "shops" ADD COLUMN "menuLayout" "MenuLayout" NOT NULL DEFAULT 'list';
