BEGIN;
-- Include restored shop access in the existing audit-backed inbox delivery.
ALTER TABLE "account_notifications" DROP CONSTRAINT "account_notifications_kind_check";
ALTER TABLE "account_notifications" ADD CONSTRAINT "account_notifications_kind_check"
  CHECK ("kind" IN ('INVITED','ROLE_CHANGED','REMOVED','DISABLED','ENABLED','ACCEPTED','DECLINED'));

CREATE OR REPLACE FUNCTION account_notification_from_staff() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient_id TEXT; recipient_email TEXT; actor_name TEXT; shop_name TEXT;
BEGIN
  IF NEW."action" NOT IN ('INVITED','ROLE_CHANGED','REMOVED','DISABLED','ENABLED','ACCEPTED','DECLINED') THEN RETURN NEW; END IF;
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
COMMIT;
