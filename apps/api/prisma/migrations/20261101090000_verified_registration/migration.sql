ALTER TABLE "users" ADD COLUMN "googleSubject" TEXT, ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "users_googleSubject_key" ON "users"("googleSubject");
