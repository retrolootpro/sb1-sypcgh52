/*
  Add account security settings and encrypted business document vault metadata.

  Documents are encrypted in the browser before upload. Supabase Storage remains
  private and RLS-limited to account members as defense in depth.
*/

CREATE TABLE IF NOT EXISTS account_security_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  require_mfa boolean NOT NULL DEFAULT false,
  allowed_mfa_methods text[] NOT NULL DEFAULT ARRAY['totp']::text[],
  passkeys_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE account_security_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Account members can read account_security_settings" ON account_security_settings;
CREATE POLICY "Account members can read account_security_settings"
  ON account_security_settings
  FOR SELECT
  TO authenticated
  USING (public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account admins can insert account_security_settings" ON account_security_settings;
CREATE POLICY "Account admins can insert account_security_settings"
  ON account_security_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_account_admin(user_id));

DROP POLICY IF EXISTS "Account admins can update account_security_settings" ON account_security_settings;
CREATE POLICY "Account admins can update account_security_settings"
  ON account_security_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_account_admin(user_id))
  WITH CHECK (public.is_account_admin(user_id));

CREATE TABLE IF NOT EXISTS business_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'Other',
  storage_path text NOT NULL UNIQUE,
  original_file_name text NOT NULL,
  mime_type text,
  encrypted_size bigint,
  encryption_version text NOT NULL DEFAULT 'AES-GCM-v1',
  encryption_salt text NOT NULL,
  encryption_iv text NOT NULL,
  visibility text NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'admin')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE business_documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS business_documents_user_type
  ON business_documents(user_id, document_type);

CREATE INDEX IF NOT EXISTS business_documents_user_created
  ON business_documents(user_id, created_at DESC);

DROP POLICY IF EXISTS "Account members can read business_documents" ON business_documents;
CREATE POLICY "Account members can read business_documents"
  ON business_documents
  FOR SELECT
  TO authenticated
  USING (
    public.is_account_member(user_id)
    AND (visibility = 'team' OR public.is_account_admin(user_id))
  );

DROP POLICY IF EXISTS "Account members can insert business_documents" ON business_documents;
CREATE POLICY "Account members can insert business_documents"
  ON business_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_account_member(user_id)
    AND (visibility = 'team' OR public.is_account_admin(user_id))
  );

DROP POLICY IF EXISTS "Account members can update business_documents" ON business_documents;
CREATE POLICY "Account members can update business_documents"
  ON business_documents
  FOR UPDATE
  TO authenticated
  USING (
    public.is_account_member(user_id)
    AND (visibility = 'team' OR public.is_account_admin(user_id))
  )
  WITH CHECK (
    public.is_account_member(user_id)
    AND (visibility = 'team' OR public.is_account_admin(user_id))
  );

DROP POLICY IF EXISTS "Account admins can delete business_documents" ON business_documents;
CREATE POLICY "Account admins can delete business_documents"
  ON business_documents
  FOR DELETE
  TO authenticated
  USING (public.is_account_admin(user_id));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-documents',
  'business-documents',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Account members can read encrypted business docs" ON storage.objects;
CREATE POLICY "Account members can read encrypted business docs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'business-documents'
    AND EXISTS (
      SELECT 1
      FROM public.business_documents d
      WHERE d.storage_path = storage.objects.name
        AND public.is_account_member(d.user_id)
        AND (d.visibility = 'team' OR public.is_account_admin(d.user_id))
    )
  );

DROP POLICY IF EXISTS "Account members can upload encrypted business docs" ON storage.objects;
CREATE POLICY "Account members can upload encrypted business docs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'business-documents'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_member(public.current_account_owner_id())
  );

DROP POLICY IF EXISTS "Account members can update encrypted business docs" ON storage.objects;
CREATE POLICY "Account members can update encrypted business docs"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'business-documents'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_member(public.current_account_owner_id())
  )
  WITH CHECK (
    bucket_id = 'business-documents'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_member(public.current_account_owner_id())
  );

DROP POLICY IF EXISTS "Account admins can delete encrypted business docs" ON storage.objects;
CREATE POLICY "Account admins can delete encrypted business docs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'business-documents'
    AND split_part(name, '/', 1) = public.current_account_owner_id()::text
    AND public.is_account_admin(public.current_account_owner_id())
  );

GRANT SELECT, INSERT, UPDATE ON account_security_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON business_documents TO authenticated;
