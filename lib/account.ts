import { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AccountRole = 'admin' | 'user';
export type AccountMembership = {
  id: string; account_owner_id: string; user_id: string | null; email: string;
  role: AccountRole; status: 'invited' | 'active' | 'revoked';
  invited_at: string | null; accepted_at: string | null;
};
export type AccountContext = {
  accountId: string; accountRole: AccountRole; membership: AccountMembership | null;
};
const accountContextCache = new Map<string, AccountContext>();
let generation = 0;

export function clearAccountContextCache() {
  generation++;
  accountContextCache.clear();
}

export async function resolveAccountContext(user: User, accessToken?: string): Promise<AccountContext> {
  const cached = accountContextCache.get(user.id);
  if (cached) return cached;
  const currentGeneration = generation;
  const token = accessToken || (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error('Sign in again to verify your team access.');
  const response = await fetch('/api/business/session', {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.message || 'Team access could not be verified.');
  if (typeof result.accountId !== 'string' || !['admin', 'user'].includes(result.accountRole)
    || result.membership?.status !== 'active' || result.membership?.user_id !== user.id
    || result.membership?.account_owner_id !== result.accountId) {
    throw new Error('The server returned invalid team access. Please contact an owner.');
  }
  const context: AccountContext = { accountId: result.accountId, accountRole: result.accountRole, membership: result.membership };
  if (currentGeneration === generation) accountContextCache.set(user.id, context);
  return context;
}

export async function getActiveAccountId(user?: User | null): Promise<string> {
  const authUser = user ?? (await supabase.auth.getUser()).data.user;
  if (!authUser) throw new Error('Not authenticated');
  return (await resolveAccountContext(authUser)).accountId;
}
