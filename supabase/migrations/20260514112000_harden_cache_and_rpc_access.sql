/*
  Close advisor-reported holes:
  - cache tables remain readable where useful, but writes are limited to service_role
  - account helper RPC functions are not executable by anonymous users
*/

DROP POLICY IF EXISTS "Authenticated users can insert cache" ON barcode_lookup_cache;
DROP POLICY IF EXISTS "Authenticated users can update cache" ON barcode_lookup_cache;
DROP POLICY IF EXISTS "cache_insert" ON barcode_lookup_cache;
DROP POLICY IF EXISTS "cache_update" ON barcode_lookup_cache;
CREATE POLICY "Service role can insert barcode cache"
  ON barcode_lookup_cache
  FOR INSERT
  TO service_role
  WITH CHECK (true);
CREATE POLICY "Service role can update barcode cache"
  ON barcode_lookup_cache
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert market price cache" ON market_price_cache;
DROP POLICY IF EXISTS "Service role can update market price cache" ON market_price_cache;
DROP POLICY IF EXISTS "market_cache_insert" ON market_price_cache;
DROP POLICY IF EXISTS "market_cache_update" ON market_price_cache;
CREATE POLICY "Service role can insert market price cache"
  ON market_price_cache
  FOR INSERT
  TO service_role
  WITH CHECK (true);
CREATE POLICY "Service role can update market price cache"
  ON market_price_cache
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE EXECUTE ON FUNCTION public.current_account_owner_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_account_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_account_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_account_admin(uuid) FROM anon;
