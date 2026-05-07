import { SupabaseClient, User } from '@supabase/supabase-js';

export type ServerAccountContext = {
  accountId: string;
  role: 'admin' | 'user';
};

export async function getServerAccountContext(supabase: SupabaseClient, user: User): Promise<ServerAccountContext> {
  const { data } = await supabase
    .from('user_account_memberships')
    .select('account_owner_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .maybeSingle();

  return {
    accountId: data?.account_owner_id || user.id,
    role: data?.role === 'user' ? 'user' : 'admin',
  };
}
