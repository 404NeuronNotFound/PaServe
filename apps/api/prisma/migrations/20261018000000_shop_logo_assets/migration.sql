-- Public storefront images; all mutations are authorized by the API.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('paserve-assets', 'paserve-assets', true, 5242880, ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/webp'];

CREATE POLICY paserve_assets_api_only ON storage.objects AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (bucket_id <> 'paserve-assets') WITH CHECK (bucket_id <> 'paserve-assets');
