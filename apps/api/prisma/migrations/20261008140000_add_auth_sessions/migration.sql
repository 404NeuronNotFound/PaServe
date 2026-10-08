BEGIN;
ALTER TABLE public.users ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE public.auth_sessions (
  id TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "auth_sessions_userId_idx" ON public.auth_sessions("userId");
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.auth_sessions FROM anon, authenticated;
COMMIT;
