'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
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
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<AccountRole | null>(null);
  const [membership, setMembership] = useState<AccountMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const applyUser = async (nextUser: User | null) => {
    setUser(nextUser);

    if (!nextUser) {
      setAccountId(null);
      setAccountRole(null);
      setMembership(null);
      return;
    }

    const account = await resolveAccountContext(nextUser);
    setAccountId(account.accountId);
    setAccountRole(account.accountRole);
    setMembership(account.membership);
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      await applyUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        if (event === 'SIGNED_OUT') clearAccountContextCache();
        await applyUser(session?.user ?? null);
        setLoading(false);
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error) {
      router.push('/dashboard');
    }
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (!error) {
      router.push('/dashboard');
    }
    return { error };
  };

  const refreshAccount = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    clearAccountContextCache();
    await applyUser(data.user);
  };

  const signOut = async () => {
    clearAccountContextCache();
    await supabase.auth.signOut();
    router.push('/');
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
        signUp,
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
