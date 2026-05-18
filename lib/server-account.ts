import { SupabaseClient, User } from '@supabase/supabase-js';

export type ServerAccountContext = {
  accountId: string;
  role: 'admin' | 'user';
};

export async function getServerAccountContext(supabase: SupabaseClient, user: User): Promise<ServerAccountContext> {
  const [{ data: rpcAccountId, error: accountError }, { data: rpcRole, error: roleError }] = await Promise.all([
    supabase.rpc('current_account_owner_id'),
    supabase.rpc('current_account_role'),
  ]);

  if (!accountError && !roleError && typeof rpcAccountId === 'string') {
    return {
      accountId: rpcAccountId,
      role: rpcRole === 'user' ? 'user' : 'admin',
    };
  }

  const { data } = await supabase
    .from('user_account_memberships')
    .select('account_owner_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('role', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    accountId: data?.account_owner_id || user.id,
    role: data?.role === 'user' ? 'user' : 'admin',
  };
}
