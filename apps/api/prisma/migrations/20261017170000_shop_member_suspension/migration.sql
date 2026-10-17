BEGIN;
ALTER TABLE "shop_members" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_owner_enabled"
  CHECK ("role" <> 'OWNER' OR "disabledAt" IS NULL);
ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_action_check";
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_action_check"
  CHECK ("action" IN ('INVITED', 'ACCEPTED', 'REVOKED', 'ROLE_CHANGED', 'REMOVED', 'ENABLED', 'DISABLED'));
COMMIT;
