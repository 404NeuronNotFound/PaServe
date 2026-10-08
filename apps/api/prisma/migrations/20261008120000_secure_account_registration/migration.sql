BEGIN;

-- Protect case-insensitive account identity, including concurrent registrations.
-- This functional index is maintained in SQL because Prisma schema indexes do
-- not represent this expression. Keep the existing email unique constraint.
CREATE UNIQUE INDEX "users_email_normalized_key"
  ON public.users (lower(btrim(email)));

-- Password hashes must never be readable with a browser's Supabase key.
-- Account access stays in NestJS/Prisma; Supabase Auth is not used.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon, authenticated;

COMMIT;
