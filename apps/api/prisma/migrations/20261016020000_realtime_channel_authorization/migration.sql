-- Supabase owns realtime.messages and already enables RLS. Verify it instead
-- of ALTER TABLE, which hosted postgres roles are not allowed to perform.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'realtime' AND c.relname = 'messages' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Realtime messages must have RLS enabled';
  END IF;
END;
$$;

-- Only the backend service role joins application channels. Browser policies
-- for unrelated features cannot grant reads/publishes in reserved namespaces.
-- Keep earlier feature policies; restrictive policies compose with AND.
CREATE POLICY app_realtime_backend_only ON realtime.messages
AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (
  topic NOT LIKE 'staff:%'
  AND topic NOT LIKE 'customer:%'
  AND topic NOT LIKE 'menu:availability:%'
)
WITH CHECK (
  topic NOT LIKE 'staff:%'
  AND topic NOT LIKE 'customer:%'
  AND topic NOT LIKE 'menu:availability:%'
);
