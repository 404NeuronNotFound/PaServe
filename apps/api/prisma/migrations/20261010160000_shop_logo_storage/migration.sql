-- Public logo delivery. All writes remain behind NestJS owner authorization.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('shop-media', 'shop-media', true, 5242880, ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/webp'];

CREATE POLICY shop_media_api_only ON storage.objects AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (bucket_id <> 'shop-media') WITH CHECK (bucket_id <> 'shop-media');
