-- Pausing order intake keeps an active shop's menu available.
ALTER TABLE "shops" ADD COLUMN "acceptingOrders" BOOLEAN NOT NULL DEFAULT true;
