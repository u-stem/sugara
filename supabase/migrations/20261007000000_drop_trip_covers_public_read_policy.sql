-- The trip-covers bucket is public, so objects are served via
-- /storage/v1/object/public/... without any SELECT policy on storage.objects.
-- The "public can read trip-covers" policy only let anon list the bucket
-- (POST /storage/v1/object/list/trip-covers), exposing every trip's cover image and tripId.
-- Uploads, copies, and deletes use the service role, which bypasses RLS.
DROP POLICY IF EXISTS "public can read trip-covers" ON storage.objects;
