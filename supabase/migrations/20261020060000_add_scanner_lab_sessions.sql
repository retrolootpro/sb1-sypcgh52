-- Scanner Lab saves observations only. It has no inventory or finance triggers.
CREATE TABLE public.scanner_lab_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (id, account_id, created_by)
);

CREATE TABLE public.scanner_lab_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  account_id uuid NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 100),
  inventory_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(inventory_snapshot) = 'array'
    AND jsonb_array_length(inventory_snapshot) <= 50
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, account_id, created_by)
    REFERENCES public.scanner_lab_sessions(id, account_id, created_by) ON DELETE CASCADE
);

CREATE INDEX scanner_lab_sessions_owner ON public.scanner_lab_sessions (account_id, created_by, created_at DESC);
CREATE INDEX scanner_lab_entries_session ON public.scanner_lab_entries (session_id, created_at DESC);

ALTER TABLE public.scanner_lab_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scanner_lab_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own lab sessions" ON public.scanner_lab_sessions
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND account_id = public.current_account_owner_id());

CREATE POLICY "Users create their own lab sessions" ON public.scanner_lab_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND account_id = public.current_account_owner_id()
    AND closed_at IS NULL
  );

CREATE POLICY "Users close their own lab sessions" ON public.scanner_lab_sessions
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND account_id = public.current_account_owner_id() AND closed_at IS NULL)
  WITH CHECK (created_by = auth.uid() AND account_id = public.current_account_owner_id() AND closed_at IS NOT NULL);

CREATE POLICY "Users read their own lab scans" ON public.scanner_lab_entries
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND account_id = public.current_account_owner_id());

CREATE POLICY "Users append scans to their open lab sessions" ON public.scanner_lab_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND account_id = public.current_account_owner_id()
    AND EXISTS (
      SELECT 1 FROM public.scanner_lab_sessions session
      WHERE session.id = session_id
        AND session.account_id = scanner_lab_entries.account_id
        AND session.created_by = auth.uid()
        AND session.closed_at IS NULL
    )
  );

REVOKE ALL ON public.scanner_lab_sessions, public.scanner_lab_entries FROM anon, authenticated;
GRANT SELECT, INSERT ON public.scanner_lab_sessions, public.scanner_lab_entries TO authenticated;
GRANT UPDATE (closed_at) ON public.scanner_lab_sessions TO authenticated;
