/*
  # Updated At Trigger Helper

  Production was missing the shared helper used by newer migrations. Keep it
  explicit so trigger-based updated_at fields work across deployed databases.
*/

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
