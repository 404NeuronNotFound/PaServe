BEGIN;
CREATE TABLE "staff_invitations" (
  "id" TEXT PRIMARY KEY,
  "shopId" TEXT NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "email" VARCHAR(254) NOT NULL,
  "role" "ShopRole" NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL UNIQUE,
  "invitedBy" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "acceptedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_invitation_role_check" CHECK ("role" <> 'OWNER'),
  CONSTRAINT "staff_invitation_email_check" CHECK ("email" = lower(btrim("email")) AND length("email") > 0),
  CONSTRAINT "staff_invitation_token_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "staff_invitation_acceptance_check" CHECK (("acceptedAt" IS NULL) = ("acceptedBy" IS NULL)),
  CONSTRAINT "staff_invitation_terminal_check" CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL)
);
CREATE UNIQUE INDEX "staff_invitations_id_shopId_key" ON "staff_invitations"("id", "shopId");
CREATE INDEX "staff_invitations_shopId_email_idx" ON "staff_invitations"("shopId", "email");
CREATE UNIQUE INDEX "staff_invitations_pending_email_key" ON "staff_invitations"("shopId", "email")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
CREATE TABLE "staff_audit_events" (
  "id" TEXT PRIMARY KEY,
  "shopId" TEXT NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "actorId" TEXT NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "targetEmail" VARCHAR(254) NOT NULL,
  "targetUserId" TEXT,
  "invitationId" TEXT,
  "previousRole" "ShopRole",
  "role" "ShopRole",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_audit_action_check" CHECK ("action" IN ('INVITED', 'ACCEPTED', 'REVOKED', 'ROLE_CHANGED', 'REMOVED'))
);
CREATE UNIQUE INDEX "staff_audit_events_id_shopId_key" ON "staff_audit_events"("id", "shopId");
CREATE INDEX "staff_audit_events_shopId_createdAt_idx" ON "staff_audit_events"("shopId", "createdAt");
ALTER TABLE "staff_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_audit_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "staff_invitations", "staff_audit_events" FROM anon, authenticated;
COMMIT;
