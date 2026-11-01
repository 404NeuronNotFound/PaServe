CREATE TABLE "walkthrough_progress" (
 "userId" TEXT NOT NULL, "scope" VARCHAR(160) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "outcome" VARCHAR(16) NOT NULL, "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "walkthrough_progress_pkey" PRIMARY KEY ("userId", "scope", "version"),
 CONSTRAINT "walkthrough_progress_user_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
 CONSTRAINT "walkthrough_progress_outcome_check" CHECK ("outcome" IN ('completed', 'skipped')),
 CONSTRAINT "walkthrough_progress_version_check" CHECK ("version" > 0)
);
ALTER TABLE "walkthrough_progress" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "walkthrough_progress" FROM anon, authenticated;
