'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2, ArrowRight } from 'lucide-react';

export function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { signIn } = useAuth();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await signIn(email.trim(), password);
      if (result.error) throw result.error;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed. Please retry.');
    } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="staff-login-form">
    <label htmlFor="email">Work email<input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} disabled={busy}/></label>
    <label htmlFor="password">Password<input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></label>
    {error && <p role="alert" className="staff-access-error">{error}</p>}
    <button type="submit" className="brand-button" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={18}/> Signing in...</> : <>Sign in to workspace <ArrowRight size={18}/></>}</button>
    <p className="staff-login-note">Team access is invitation-only. Contact a Pixel &amp; Page owner if you need an invitation or help signing in.</p>
  </form>;
}
