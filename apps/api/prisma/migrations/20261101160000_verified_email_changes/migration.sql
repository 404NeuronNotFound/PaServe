CREATE TABLE "pending_email_changes" (
"id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE,
"oldEmail" VARCHAR(254) NOT NULL, "newEmail" VARCHAR(254) NOT NULL,
"credentialStamp" VARCHAR(64) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
"resendAt" TIMESTAMP(3) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
"currentConfirmed" BOOLEAN NOT NULL DEFAULT false, "newConfirmed" BOOLEAN NOT NULL DEFAULT false,
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
ALTER TABLE "pending_email_changes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "pending_email_changes" FROM anon, authenticated;
