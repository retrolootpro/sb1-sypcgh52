import { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AccountRole = 'admin' | 'user';

export type AccountMembership = {
  id: string;
  account_owner_id: string;
  user_id: string | null;
  email: string;
  role: AccountRole;
  status: 'invited' | 'active' | 'revoked';
  invited_at: string | null;
  accepted_at: string | null;
};

export type AccountContext = {
  accountId: string;
  accountRole: AccountRole;
  membership: AccountMembership | null;
};

const accountContextCache = new Map<string, AccountContext>();

export function clearAccountContextCache() {
  accountContextCache.clear();
}

export async function resolveAccountContext(user: User): Promise<AccountContext> {
  const cached = accountContextCache.get(user.id);
  if (cached) return cached;

  const fallback: AccountContext = {
    accountId: user.id,
    accountRole: 'admin',
    membership: null,
  };

  try {
    const { data: activeMembership, error: activeError } = await supabase
      .from('user_account_memberships')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .maybeSingle();

    if (activeError) throw activeError;

    if (activeMembership) {
      const context = {
        accountId: activeMembership.account_owner_id,
        accountRole: activeMembership.role as AccountRole,
        membership: activeMembership as AccountMembership,
      };
      accountContextCache.set(user.id, context);
      return context;
    }

    if (user.email) {
      const { data: invite } = await supabase
        .from('user_account_memberships')
        .select('*')
        .eq('email', user.email.toLowerCase())
        .eq('status', 'invited')
        .order('invited_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (invite) {
        const { data: accepted, error: acceptError } = await supabase
          .from('user_account_memberships')
          .update({
            user_id: user.id,
            status: 'active',
            accepted_at: new Date().toISOString(),
          })
          .eq('id', invite.id)
          .select('*')
          .single();

        if (!acceptError && accepted) {
          const context = {
            accountId: accepted.account_owner_id,
            accountRole: accepted.role as AccountRole,
            membership: accepted as AccountMembership,
          };
          accountContextCache.set(user.id, context);
          return context;
        }
      }
    }

    const { data: created, error: createError } = await supabase
      .from('user_account_memberships')
      .insert({
        account_owner_id: user.id,
        user_id: user.id,
        email: (user.email || '').toLowerCase(),
        role: 'admin',
        status: 'active',
        accepted_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (createError) throw createError;

    const context = {
      accountId: created.account_owner_id,
      accountRole: created.role as AccountRole,
      membership: created as AccountMembership,
    };
    accountContextCache.set(user.id, context);
    return context;
  } catch (error) {
    console.warn('Account membership resolution fell back to owner account:', error);
    accountContextCache.set(user.id, fallback);
    return fallback;
  }
}

export async function getActiveAccountId(user?: User | null): Promise<string> {
  const authUser = user ?? (await supabase.auth.getUser()).data.user;
  if (!authUser) throw new Error('Not authenticated');
  return (await resolveAccountContext(authUser)).accountId;
}
