BEGIN;
ALTER TABLE "staff_invitations" ADD COLUMN "declinedAt" TIMESTAMP(3);
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitation_decline_check"
  CHECK ("declinedAt" IS NULL OR ("revokedAt" IS NOT NULL AND "acceptedAt" IS NULL));
ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_action_check";
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_action_check"
  CHECK ("action" IN ('INVITED','ACCEPTED','DECLINED','REVOKED','ROLE_CHANGED','REMOVED','ENABLED','DISABLED'));

CREATE TABLE "account_notifications" (
  "id" TEXT PRIMARY KEY,
  "recipientUserId" TEXT,
  "recipientEmail" VARCHAR(254) NOT NULL,
  "kind" VARCHAR(32) NOT NULL CHECK ("kind" IN ('INVITED','ROLE_CHANGED','REMOVED','DISABLED','ACCEPTED','DECLINED')),
  "shopId" TEXT NOT NULL,
  "shopName" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "role" "ShopRole",
  "previousRole" "ShopRole",
  "invitationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3)
);
CREATE INDEX "account_notifications_recipientUserId_createdAt_id_idx" ON "account_notifications" ("recipientUserId","createdAt","id");
CREATE INDEX "account_notifications_recipientEmail_createdAt_id_idx" ON "account_notifications" ("recipientEmail","createdAt","id");
ALTER TABLE "account_notifications" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "account_notifications" FROM anon, authenticated;

-- Reuse the staff audit transaction: failures roll back both the event and inbox
-- delivery. One audit ID is one notification, including concurrent retries.
CREATE FUNCTION account_notification_from_staff() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient_id TEXT; recipient_email TEXT; actor_name TEXT; shop_name TEXT;
BEGIN
  IF NEW."action" NOT IN ('INVITED','ROLE_CHANGED','REMOVED','DISABLED','ACCEPTED','DECLINED') THEN RETURN NEW; END IF;
  IF NEW."action" IN ('ACCEPTED','DECLINED') THEN
    SELECT i."invitedBy" INTO recipient_id FROM staff_invitations i
      WHERE i.id = NEW."invitationId" AND i."shopId" = NEW."shopId";
    SELECT u.email INTO recipient_email FROM users u WHERE u.id = recipient_id;
    -- The result belongs to the issuing owner, provided they still manage it.
    IF NOT EXISTS (SELECT 1 FROM shop_members m JOIN users u ON u.id=m."userId"
      JOIN shops s ON s.id=m."shopId" WHERE m."userId"=recipient_id AND m."shopId"=NEW."shopId"
      AND m.role='OWNER' AND m."disabledAt" IS NULL AND u."isActive" AND s."isActive") THEN RETURN NEW; END IF;
  ELSE
    recipient_id := NEW."targetUserId";
    recipient_email := NEW."targetEmail";
  END IF;
  SELECT COALESCE(NULLIF(btrim(concat_ws(' ',u."firstName",u."lastName")),''),u.email)
    INTO actor_name FROM users u WHERE u.id=NEW."actorId";
  SELECT s.name INTO shop_name FROM shops s WHERE s.id=NEW."shopId";
  INSERT INTO account_notifications (id,"recipientUserId","recipientEmail",kind,"shopId","shopName","actorName",role,"previousRole","invitationId","createdAt")
    VALUES (NEW.id,recipient_id,recipient_email,NEW.action,NEW."shopId",shop_name,COALESCE(actor_name,'Shop owner'),NEW.role,NEW."previousRole",NEW."invitationId",NEW."createdAt");
  RETURN NEW;
END $$;
CREATE TRIGGER staff_account_notification AFTER INSERT ON "staff_audit_events"
  FOR EACH ROW EXECUTE FUNCTION account_notification_from_staff();

-- Deliver still-pending invitations created before this feature, including
-- invitations to people who have not registered yet. Do not replay old changes.
INSERT INTO "account_notifications" (id,"recipientEmail",kind,"shopId","shopName","actorName",role,"invitationId","createdAt")
SELECT i.id,i.email,'INVITED',i."shopId",s.name,
  COALESCE(NULLIF(btrim(concat_ws(' ',u."firstName",u."lastName")),''),u.email),i.role,i.id,i."createdAt"
FROM "staff_invitations" i JOIN "shops" s ON s.id=i."shopId" JOIN "users" u ON u.id=i."invitedBy"
WHERE i."acceptedAt" IS NULL AND i."revokedAt" IS NULL AND i."expiresAt">CURRENT_TIMESTAMP;
COMMIT;
