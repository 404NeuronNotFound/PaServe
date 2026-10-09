BEGIN;
-- NestJS owns shop and membership access; browser keys must not bypass it.
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.shops FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.shop_members FROM anon, authenticated;
COMMIT;
