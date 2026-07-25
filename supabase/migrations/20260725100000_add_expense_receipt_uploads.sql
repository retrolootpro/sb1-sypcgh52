/*
  Add private receipt uploads for business expenses.

  Receipt files are stored in a private Supabase Storage bucket under the
  active account id. Expense rows keep the durable storage path so the app can
  create short-lived signed URLs when a receipt needs to be viewed.
*/

ALTER TABLE business_expenses
  ADD COLUMN IF NOT EXISTS receipt_storage_path text,
  ADD COLUMN IF NOT EXISTS receipt_file_name text,
  ADD COLUMN IF NOT EXISTS receipt_mime_type text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Account members can read expense receipts" ON storage.objects;
CREATE POLICY "Account members can read expense receipts"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_member(public.current_account_owner_id())
  );

DROP POLICY IF EXISTS "Account members can upload expense receipts" ON storage.objects;
CREATE POLICY "Account members can upload expense receipts"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_member(public.current_account_owner_id())
  );

DROP POLICY IF EXISTS "Account members can update expense receipts" ON storage.objects;
CREATE POLICY "Account members can update expense receipts"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_member(public.current_account_owner_id())
  )
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_member(public.current_account_owner_id())
  );

DROP POLICY IF EXISTS "Account admins can delete expense receipts" ON storage.objects;
CREATE POLICY "Account admins can delete expense receipts"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_admin(public.current_account_owner_id())
  );
