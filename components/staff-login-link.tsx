'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LogIn, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function StaffLoginLink() {
  const { user, accountId, loading, accessError, signOutForEntry } = useAuth();
  const [busy, setBusy] = useState(false);
  const staff = !loading && user && accountId;
  return <><Link href="/login" className="staff-login-link" aria-disabled={busy || undefined}
    onClick={async event => {
      if (!staff && !busy) return;
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      try { await signOutForEntry(); }
      finally { setBusy(false); }
    }}>
    {staff ? <LayoutDashboard/> : <LogIn/>}<span>{staff ? 'Business workspace' : 'Login'}</span>
  </Link>{accessError && staff && <p role="alert" className="staff-access-error">{accessError}</p>}</>;
}
