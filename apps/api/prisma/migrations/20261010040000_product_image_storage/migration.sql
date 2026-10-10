-- Public delivery for menu images; authenticated media writes go through NestJS only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-media', 'product-media', true, 5242880, ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/webp'];

-- Restrictive policies also block access through pre-existing permissive policies.
CREATE POLICY product_media_api_only ON storage.objects AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (bucket_id <> 'product-media') WITH CHECK (bucket_id <> 'product-media');
