/*
  Add first-class book metadata to inventory items.

  These columns let books store edition/format and bibliographic fields without
  overloading video-game oriented fields like genre or PriceCharting metadata.
*/

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS book_format text,
  ADD COLUMN IF NOT EXISTS book_authors text[],
  ADD COLUMN IF NOT EXISTS book_publisher text,
  ADD COLUMN IF NOT EXISTS book_published_date text,
  ADD COLUMN IF NOT EXISTS book_published_year text,
  ADD COLUMN IF NOT EXISTS book_page_count integer,
  ADD COLUMN IF NOT EXISTS book_language text,
  ADD COLUMN IF NOT EXISTS book_isbn10 text,
  ADD COLUMN IF NOT EXISTS book_isbn13 text,
  ADD COLUMN IF NOT EXISTS book_cover_url text,
  ADD COLUMN IF NOT EXISTS book_metadata_source text,
  ADD COLUMN IF NOT EXISTS book_metadata_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_inventory_items_book_isbn13
  ON inventory_items(book_isbn13)
  WHERE book_isbn13 IS NOT NULL AND book_isbn13 <> '';

CREATE INDEX IF NOT EXISTS idx_inventory_items_book_isbn10
  ON inventory_items(book_isbn10)
  WHERE book_isbn10 IS NOT NULL AND book_isbn10 <> '';
