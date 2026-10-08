BEGIN;

-- Realtime is opt-in. Keep identities and memberships out of the publication.
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- NestJS owns product access. No browser policies are introduced by this
-- foundation migration; future client subscriptions need explicit authorization.
REVOKE ALL PRIVILEGES ON TABLE public.products FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  END IF;
END $$;

COMMIT;
