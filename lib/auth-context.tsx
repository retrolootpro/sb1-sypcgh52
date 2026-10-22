'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { type AuthError, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { useRouter } from 'next/navigation';
import { AccountMembership, AccountRole, clearAccountContextCache, resolveAccountContext } from './account';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  accountId: string | null;
  accountRole: AccountRole | null;
  membership: AccountMembership | null;
  isAdmin: boolean;
  refreshAccount: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  accessError: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<AccountRole | null>(null);
  const [membership, setMembership] = useState<AccountMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState('');
  const generation = useRef({});
  const verifiedSession = useRef<{ userId: string; token?: string } | null>(null);
  const router = useRouter();

  const applyUser = useCallback(async (nextUser: User | null, token?: string) => {
    const request = {};
    generation.current = request;
    verifiedSession.current = null;
    setLoading(true);
    setUser(nextUser);
    setAccountId(null);
    setAccountRole(null);
    setMembership(null);
    setAccessError('');
    if (!nextUser) {
      setLoading(false);
      return;
    }
    try {
      const account = await resolveAccountContext(nextUser, token);
      if (request !== generation.current) return;
      setAccountId(account.accountId);
      setAccountRole(account.accountRole);
      setMembership(account.membership);
      verifiedSession.current = { userId: nextUser.id, token };
    } catch (error) {
      console.error('Team access verification:', error);
      if (request === generation.current) setAccessError(error instanceof Error ? error.message : 'Team access could not be verified.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let authEventReceived = false;
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!active || authEventReceived) return;
      if (error) { console.error('Session restoration:', error); setAccessError(error.message); setLoading(false); return; }
      await applyUser(session?.user ?? null, session?.access_token);
    }).catch(error => {
      console.error('Session restoration:', error);
      if (active) { setAccessError('Your sign-in session could not be restored. Please retry.'); setLoading(false); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      // Supabase repeats SIGNED_IN on focus and across the embedded scanner.
      if (_event === 'SIGNED_IN' && session?.access_token && verifiedSession.current?.userId === session.user.id
        && verifiedSession.current.token === session.access_token) return;
      clearAccountContextCache();
      (async () => {
        await applyUser(session?.user ?? null, session?.access_token);
      })();
    });

    return () => { active = false; generation.current = {}; subscription.unsubscribe(); };
  }, [applyUser]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const refreshAccount = async () => {
    setLoading(true);
    clearAccountContextCache();
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      await applyUser(data.session?.user ?? null, data.session?.access_token);
    } catch (error) {
      console.error('Team access refresh:', error);
      setAccountId(null); setAccountRole(null); setMembership(null);
      setAccessError('Unable to refresh team access. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    clearAccountContextCache();
    const { error } = await supabase.auth.signOut();
    if (error) { console.error('Sign out:', error); setAccessError('Sign out failed. Please retry.'); return; }
    await applyUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accountId,
        accountRole,
        membership,
        isAdmin: accountRole === 'admin',
        refreshAccount,
        signIn,
        accessError,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
