'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { clearAccountContextCache } from '@/lib/account';
import { Button } from '@/components/ui/button';
import { staffReturnPath } from '@/lib/business-routes';
import { resolveAccountContext } from '@/lib/account';
import Link from 'next/link';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState('Finishing your secure sign in...');
  const [failed, setFailed] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function finish() {
      const next = staffReturnPath(searchParams.get('next'));
      try {
        const code = searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.access_token) throw new Error('No sign-in session was found. Please open the latest invite email and try again.');

        setMessage('Connecting your team access...');
        const response = await fetch('/api/team/accept-invite', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Team invitation could not be accepted.');

        clearAccountContextCache();
        await resolveAccountContext(session.user, session.access_token);
        if (!mounted) return;
        if (searchParams.get('invite') === '1' || hashParams.get('type') === 'invite') {
          setNeedsPassword(true);
          setMessage('Your invitation is accepted. Set a password for future staff sign-ins.');
          return;
        }
        setMessage('All set. Opening Pixel & Page Business...');
        router.replace(next);
      } catch (error) {
        if (!mounted) return;
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'The invite link could not be completed.');
      }
    }

    finish();
    return () => { mounted = false; };
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/50 bg-card p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl border border-primary/30 bg-primary/10 text-primary flex items-center justify-center">
            {failed ? <TriangleAlert className="w-5 h-5 text-amber-300" /> : <CheckCircle2 className="w-5 h-5" />}
          </div>
          <div>
            <div className="text-lg font-bold text-white/90">Pixel &amp; Page team access</div>
            <div className="text-xs text-muted-foreground">Team access setup</div>
          </div>
        </div>
        <div className="rounded-xl border border-border/30 bg-secondary/20 p-4">
          <div className="flex items-center gap-3">
            {!failed && !needsPassword && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
            <p className="text-sm text-white/75 leading-relaxed">{message}</p>
          </div>
          {needsPassword && <form className="staff-login-form mt-6" onSubmit={async event => {
            event.preventDefault(); setSaving(true); setPasswordError('');
            try {
              const { error } = await supabase.auth.updateUser({ password });
              if (error) throw error;
              router.replace(staffReturnPath(searchParams.get('next')));
            } catch (error) { setPasswordError(error instanceof Error ? error.message : 'Password could not be saved. Please retry.'); }
            finally { setSaving(false); }
          }}><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} disabled={saving} onChange={e => setPassword(e.target.value)}/></label>
            <p className="text-sm">Use at least 12 characters.</p>{passwordError && <p role="alert">{passwordError}</p>}<button className="brand-button" disabled={saving}>{saving ? 'Saving password...' : 'Save password & open workspace'}</button></form>}
        </div>
        {failed && (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => router.replace('/login')}>Back to sign in</Button>
          </div>
        )}
        <Link href="/" className="staff-back-link mt-4">Back to the shop</Link>
      </div>
    </div>
  );
}
